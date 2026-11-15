import { color, isCoordinate } from "./config.js";

export function selectRecords(config, hass) {
  const states = hass?.states || {};
  const selected = new Map(config.entities.map(e => [typeof e === "string" ? e : e.entity, e]));
  const domains = new Set(config.include_domains), sources = new Set(config.geo_location_sources);
  if (domains.size || sources.size) for (const [id, state] of Object.entries(states)) {
    const domain = id.split(".")[0], attrs = state.attributes || {};
    if ((domains.has(domain) && (attrs.latitude !== undefined || ["person", "device_tracker", "zone"].includes(domain))) ||
      (domain === "geo_location" && sources.has(attrs.source))) {
      if (!selected.has(id)) selected.set(id, id);
    }
  }
  const records = [...selected].slice(0, 500).map(([id, options]) => {
    const state = states[id], attrs = state?.attributes || {};
    // Empty strings and null are not coordinates; numeric strings remain supported.
    const numeric = value => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    const lat = numeric(attrs.latitude), lon = numeric(attrs.longitude);
    const available = !!state && !["unknown", "unavailable"].includes(state.state);
    return { id, state, name: String(options?.name || attrs.friendly_name || id),
      color: color(options?.color) || color(config.marker.color.default), lat, lon,
      mapped: available && isCoordinate(lat, lon), available,
      updated: state?.last_updated || state?.last_changed || null,
      accuracy: Math.min(100000, Math.max(0, numeric(attrs.gps_accuracy) || 0)),
      radius: Math.min(100000, Math.max(0, numeric(attrs.radius) || 0)),
      zone: id.startsWith("zone."), battery: attrs.battery_level ?? null };
  });
  records.total = selected.size;
  return records;
}

export function resolveText(state, template) {
  const attrs = state?.attributes || {};
  const value = key => key === "state" ? state?.state : key === "entity_id" ? state?.entity_id : key === "last_updated" ? state?.last_updated : attrs[key];
  const printable = val => val == null ? "" : typeof val === "object" ? JSON.stringify(val).slice(0, 1000) : String(val).slice(0, 1000);
  if (!template.includes("{") && value(template) != null) return printable(value(template));
  return template.replace(/\{([\w.]+)\}/g, (_, key) => printable(value(key.replace(/^attributes\./, ""))));
}

export function markerText(record, mode) {
  if (mode === "state") return String(record.state?.state ?? "").slice(0, 10);
  if (mode === "name") return record.name.length > 16 ? `${record.name.slice(0, 15)}…` : record.name;
  return record.name.trim().split(/\s+/).map(word => [...word][0] || "").slice(0, 2).join("").toUpperCase();
}
