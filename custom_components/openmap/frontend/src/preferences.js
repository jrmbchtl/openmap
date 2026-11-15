export function preferenceKey(userId, config) {
  if (!userId) return null;
  let hash = 2166136261;
  const identity = config.map_id || JSON.stringify([config.title, config.entities, config.include_domains, config.geo_location_sources]);
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `openmap:v1:${userId}:${hash >>> 0}`;
}
export function readVisibility(storage, key, layers) {
  let saved = {};
  try { if (key) saved = JSON.parse(storage.getItem(key) || "{}"); } catch { /* Private mode or corrupt preferences. */ }
  return Object.fromEntries(layers.map(l => [l.preset, typeof saved?.[l.preset] === "boolean" ? saved[l.preset] : l.visible]));
}
export function saveVisibility(storage, key, visibility) {
  const safe = Object.fromEntries(Object.entries(visibility).filter(([preset, value]) => ["baustellen", "radverkehr", "parken", "bus", "winterdienst", "eladestationen"].includes(preset) && typeof value === "boolean"));
  try { if (key) storage.setItem(key, JSON.stringify(safe)); } catch { /* Storage is optional. */ }
}
