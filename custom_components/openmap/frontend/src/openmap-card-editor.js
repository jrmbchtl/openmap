import { LitElement, html, css, nothing } from "lit";
import { normalizeConfig, retainEntries, PRESETS } from "./config.js";
import { localize } from "./localize.js";

class OpenmapCardEditor extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true }, _data: { state: true }, _error: { state: true } };
  setConfig(input) {
    this._config = normalizeConfig(input);
    const c = this._config;
    this._data = { title: c.title, entities: c.entities.map(e => typeof e === "string" ? e : e.entity),
      overlay_layers: c.overlay_layers.map(l => l.preset), include_domains: c.include_domains,
      geo_location_sources: c.geo_location_sources.join(", "), basemap: c.basemap, theme_mode: c.theme_mode,
      default_zoom: c.default_zoom, cluster: c.cluster, map_id: c.map_id,
      center_lat: c.center?.[0], center_lon: c.center?.[1] };
  }
  _t(key) { return localize(this.hass?.language, key); }
  _change(event) {
    event.stopPropagation();
    this._data = { ...this._data, ...event.detail.value };
    const previous = this._config;
    const data = this._data;
    const center = data.center_lat == null || data.center_lat === "" ? null : [Number(data.center_lat), Number(data.center_lon)];
    if ((data.center_lat == null || data.center_lat === "") !== (data.center_lon == null || data.center_lon === "")) {
      this._error = "Set both latitude and longitude, or clear the center."; return;
    }
    try {
      const { center_lat: _lat, center_lon: _lon, ...fields } = data;
      const next = normalizeConfig({ ...previous, ...fields, center,
        entities: retainEntries(previous.entities, data.entities || [], "entity", id => id),
        overlay_layers: retainEntries(previous.overlay_layers, data.overlay_layers || [], "preset", preset => ({ preset, visible: false })),
      });
      this._error = null;
      this._config = next;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
    } catch (error) { this._error = error.message; }
  }
  _clearCenter() {
    this._change({ stopPropagation() {}, detail: { value: { center_lat: undefined, center_lon: undefined } } });
  }
  _label = schema => this._t({ overlay_layers: "defaults", geo_location_sources: "sources", include_domains: "domains", theme_mode: "theme", default_zoom: "zoom", map_id: "mapId", center_lat: "centerLat", center_lon: "centerLon" }[schema.name] || schema.name);
  render() {
    if (!this._config || !this.hass) return nothing;
    const content = [
      { name: "entities", selector: { entity: { multiple: true } } },
      { name: "overlay_layers", selector: { select: { multiple: true, mode: "list", options: Object.entries(PRESETS).map(([value, label]) => ({ value, label })) } } },
      { name: "include_domains", selector: { select: { multiple: true, options: ["person", "device_tracker", "zone", "sensor", "geo_location", "camera"] } } },
      { name: "geo_location_sources", selector: { text: {} } },
    ];
    const appearance = [
      { name: "title", selector: { text: {} } },
      { name: "basemap", selector: { select: { options: ["osm", "carto"] } } },
      { name: "theme_mode", selector: { select: { options: ["auto", "light", "dark"] } } },
      { name: "cluster", selector: { boolean: {} } },
      { name: "default_zoom", selector: { number: { min: 0, max: 20, step: 1, mode: "box" } } },
      { name: "map_id", selector: { text: {} } },
      { name: "center_lat", selector: { number: { min: -90, max: 90, step: 0.0001, mode: "box" } } },
      { name: "center_lon", selector: { number: { min: -180, max: 180, step: 0.0001, mode: "box" } } },
    ];
    return html`<h2>${this._t("content")}</h2><p>${this._t("selected")}</p>
      <ha-form .hass=${this.hass} .data=${this._data} .schema=${content} .computeLabel=${this._label} @value-changed=${this._change}></ha-form>
      <h2>${this._t("appearance")}</h2>
      <ha-form .hass=${this.hass} .data=${this._data} .schema=${appearance} .computeLabel=${this._label} @value-changed=${this._change}></ha-form>
      <button @click=${this._clearCenter}>${this._t("clearCenter")}</button>
      ${this._error ? html`<p role="alert">${this._error}</p>` : nothing}
      <p>${this._t("advanced")}</p>`;
  }
  static styles = css`
    :host { display:block; color:var(--primary-text-color); font-family:var(--ha-font-family-body,Roboto,sans-serif); }
    h2 { font-size:18px; font-weight:500; margin:24px 0 8px; } h2:first-child { margin-top:0; }
    p { color:var(--secondary-text-color); font-size:14px; line-height:1.5; margin:8px 0 16px; max-width:65ch; }
    button { min-height:48px; padding:8px 16px; border:0; border-radius:8px; background:var(--secondary-background-color); color:var(--primary-text-color); font:inherit; cursor:pointer; }
    button:focus-visible { outline:3px solid var(--primary-color); outline-offset:2px; }
    [role="alert"] { color:var(--error-color); } ::selection { background:var(--primary-color); color:var(--text-primary-color); }
  `;
}
if (!customElements.get("openmap-card-editor")) customElements.define("openmap-card-editor", OpenmapCardEditor);
