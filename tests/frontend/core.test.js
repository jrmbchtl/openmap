import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, retainEntries } from "../../custom_components/openmap/frontend/src/config.js";
import { selectRecords, resolveText } from "../../custom_components/openmap/frontend/src/entities.js";
import { preferenceKey, readVisibility, saveVisibility } from "../../custom_components/openmap/frontend/src/preferences.js";
import { TileLoader } from "../../custom_components/openmap/frontend/src/tile-loader.js";
import { readFileSync } from "node:fs";

for (const [index, fixture] of JSON.parse(readFileSync("tests/config_contract.json")).entries()) {
  test(`shared configuration contract ${index}`, () => {
    const result = normalizeConfig(fixture.input);
    for (const [key, expected] of Object.entries(fixture.expected)) assert.deepEqual(result[key], expected);
  });
}

test("canonical aliases, zero center, explicit clearing, safe colors", () => {
  const c = normalizeConfig({ center_lat: 0, center_lon: 0, dark_mode: "dark", geolocation_sources: "a, b", marker: { color: { default: "red;position:fixed" } } });
  assert.deepEqual(c.center, [0, 0]); assert.equal(c.theme_mode, "dark");
  assert.deepEqual(c.geo_location_sources, ["a", "b"]); assert.equal(c.marker.color.default, "default");
  assert.deepEqual(normalizeConfig({ geo_location_sources: [], geolocation_sources: "old" }).geo_location_sources, []);
  assert.throws(() => normalizeConfig({ center: [91, 0] }));
});
test("editor selection preserves rich entries", () => {
  const entry = { preset: "bus", name: "My buses", visible: true, opacity: 0.4 };
  assert.equal(retainEntries([entry], ["bus"], "preset", preset => ({ preset }))[0], entry);
  assert.deepEqual(normalizeConfig({ overlay_layers: [entry] }).overlay_layers[0], entry);
});
test("entity selection includes zero, removes unavailable and retains missing", () => {
  const config = normalizeConfig({ entities: ["person.zero", "person.missing"], include_domains: ["sensor"] });
  const states = { "person.zero": { state: "home", attributes: { latitude: 0, longitude: 0 } }, "sensor.temp": { state: "20", attributes: {} } };
  let records = selectRecords(config, { states });
  assert.equal(records.length, 2); assert.equal(records[0].mapped, true); assert.equal(records[1].available, false);
  records = selectRecords(config, { states: { "person.zero": { ...states["person.zero"], state: "unavailable" } } });
  assert.equal(records[0].mapped, false);
});
test("popup templates remain text and handle missing values", () => {
  assert.equal(resolveText({ state: "home", attributes: { friendly_name: '<img onerror="bad">' } }, "{friendly_name}: {state} {missing}"), '<img onerror="bad">: home ');
});
test("preferences are user/map scoped and store only booleans", () => {
  const c = normalizeConfig({ overlay_layers: [{ preset: "bus", visible: true }] });
  const storage = new Map(); storage.getItem = storage.get.bind(storage); storage.setItem = storage.set.bind(storage);
  const key = preferenceKey("a", c); assert.notEqual(key, preferenceKey("b", c));
  saveVisibility(storage, key, { bus: false }); assert.deepEqual(readVisibility(storage, key, c.overlay_layers), { bus: false });
  assert.deepEqual(readVisibility({ getItem() { throw new Error(); } }, key, c.overlay_layers), { bus: true });
});
test("tile loader restricts path and bounds queued/cancelled work", async () => {
  const loader = new TileLoader((_path, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })), 1, 1);
  await assert.rejects(loader.load("https://bad.example/"));
  const first = loader.load("/api/openmap/traffic/bus/5/23/23.png");
  const second = loader.load("/api/openmap/traffic/bus/5/24/23.png");
  await assert.rejects(loader.load("/api/openmap/traffic/bus/5/25/23.png"), /full/);
  loader.close();
  await assert.rejects(first); await assert.rejects(second);
});
