export const VERSION = "1.0.1";
export const PRESETS = Object.freeze({
  baustellen: "Baustellen", radverkehr: "Radverkehr", parken: "Parken",
  bus: "Bus", winterdienst: "Winterdienst", eladestationen: "E-Ladestationen",
});
export const COLORS = Object.freeze({ red: "#d32f2f", orange: "#ef6c00", green: "#388e3c", blue: "#1976d2", purple: "#7b1fa2" });
export const isCoordinate = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
export const list = value => [...new Set((Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).map(v => typeof v === "string" ? v.trim() : v).filter(Boolean))];
export const color = value => Object.hasOwn(COLORS, value || "") ? COLORS[value] : /^#[\da-f]{6}$/i.test(value || "") ? value : null;
export function overlays(value) {
  const result = new Map();
  for (const entry of list(value)) {
    const preset = typeof entry === "string" ? entry : entry?.preset || entry?.layer || entry?.value;
    if (!Object.hasOwn(PRESETS, preset || "")) continue;
    result.set(preset, { preset, name: String(entry?.name || PRESETS[preset]).slice(0, 100),
      visible: entry?.visible === true, opacity: Number.isFinite(entry?.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 0.9 });
  }
  return [...result.values()];
}
export function normalizeConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Open Map configuration must be an object");
  let center = input.center ?? null;
  const lat = input.center_lat, lon = input.center_lon;
  if (lat != null && String(lat).trim() || lon != null && String(lon).trim()) {
    if (lat == null || lon == null || !String(lat).trim() || !String(lon).trim()) throw new Error("Map center requires both latitude and longitude");
    center = [Number(lat), Number(lon)];
  }
  if (center !== null && (!Array.isArray(center) || !isCoordinate(center[0], center[1]))) throw new Error("Map center requires valid latitude and longitude");
  const mode = input.theme_mode ?? input.dark_mode ?? "auto";
  if (!["auto", "light", "dark"].includes(mode)) throw new Error("Theme mode must be auto, light, or dark");
  const provider = input.basemap ?? "osm";
  if (!["osm", "carto"].includes(provider)) throw new Error("Basemap must be osm or carto");
  const entities = new Map();
  for (const entry of list(input.entities)) {
    const id = typeof entry === "string" ? entry : entry?.entity;
    if (!/^[a-z_]+\.[a-z\d_]+$/.test(id || "")) throw new Error("Each entity needs a valid entity ID");
    entities.set(id, typeof entry === "string" ? entry : { entity: id, ...(entry.name ? { name: String(entry.name).slice(0, 200) } : {}), ...(color(entry.color) ? { color: color(entry.color) } : {}) });
  }
  return { type: "custom:openmap-card", config_version: 1, title: String(input.title ?? "Open Map").slice(0, 200),
    map_id: String(input.map_id ?? "").slice(0, 100), entities: [...entities.values()],
    geo_location_sources: list(input.geo_location_sources ?? input.geolocation_sources),
    include_domains: list(input.include_domains).filter(v => typeof v === "string" && /^[a-z_]+$/.test(v)),
    overlay_layers: overlays(input.overlay_layers), center, default_zoom: Number.isFinite(input.default_zoom) ? Math.min(20, Math.max(0, input.default_zoom)) : 14,
    theme_mode: mode, basemap: provider, cluster: input.cluster !== false,
    attribution: String(input.attribution ?? "").slice(0, 500),
    marker: { size: Number.isFinite(input.marker?.size) ? Math.min(64, Math.max(24, input.marker.size)) : 40,
      label_mode: ["initials", "name", "state", "icon"].includes(input.marker?.label_mode) ? input.marker.label_mode : "initials",
      color: { default: color(input.marker?.color?.default) ?? "default" },
      popup: { title: String(input.marker?.popup?.title ?? "friendly_name").slice(0, 1000), body: String(input.marker?.popup?.body ?? "").slice(0, 4000),
        fields: Array.isArray(input.marker?.popup?.fields) ? input.marker.popup.fields.slice(0, 12).map(f => ({ label: String(f.label ?? "").slice(0, 100), value: String(f.value ?? "").slice(0, 1000) })) : [] } },
  };
}

// Preserve object entries and per-entry options through multi-select editing.
export function retainEntries(previous, ids, key, create) {
  return ids.map(id => previous.find(entry => (typeof entry === "string" ? entry : entry[key]) === id) ?? create(id));
}
