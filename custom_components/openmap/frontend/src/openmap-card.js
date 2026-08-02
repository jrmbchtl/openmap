import { LitElement, html, css, nothing } from "lit";
import L from "leaflet";
import "./openmap-card-editor.js";

const CARD_VERSION = "0.2.1";

// Debug logging: opt-in via ?debug=1, ?openmap_debug=1, or
// localStorage["openmap_debug"] = "1".
const _isDebugFromUrl = () => {
  try {
    if (typeof window === "undefined") return false;
    const qs = window.location?.search || "";
    if (qs.includes("debug=1") || qs.includes("openmap_debug=1")) return true;
    if (window.localStorage?.getItem("openmap_debug") === "1") return true;
  } catch (e) {
    // ignore
  }
  return false;
};

const _dlog = (tag, ...args) => {
  if (typeof window === "undefined" || !window.__OPENMAP_DEBUG) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`%c[openmap ${tag}]`, "color:#4caf50;font-weight:600", ...args);
  } catch (e) {
    // ignore
  }
};

const _dwarn = (tag, ...args) => {
  try {
    // eslint-disable-next-line no-console
    console.warn(`[openmap ${tag}]`, ...args);
  } catch (e) {
    // ignore
  }
};

if (typeof window !== "undefined") {
  window.__OPENMAP_DEBUG = _isDebugFromUrl();
  _dwarn("load", `openmap-card.js v${CARD_VERSION} loaded; debug=${window.__OPENMAP_DEBUG}`);
}

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STADIA_DARK_URL = "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png";
const STADIA_DARK_ATTR = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

const DEFAULT_CENTER = [48.8, 9.2];
const DEFAULT_ZOOM = 7;
const MIN_SIZE_W = 200;
const MIN_SIZE_H = 100;

const MARKER_COLORS = {
  red: "#F44336",
  orange: "#FF9800",
  green: "#4CAF50",
  blue: "#2196F3",
  purple: "#9C27B0",
};

const pinSVG = (c) => {
  const color = MARKER_COLORS[c] || "#F44336";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>`;
};

const esc = (s) => {
  if (s == null) return "";
  if (typeof s === "object") s = JSON.stringify(s);
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
};

const debounce = (fn, delay) => {
  let timeoutId;
  const debounced = (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timeoutId);
  return debounced;
};

const getRelevantEntityIds = (config, hass) => {
  const entityIds = new Set();
  const states = hass?.states || {};

  (config.entities || []).forEach(e => {
    const entityId = typeof e === "string" ? e : e?.entity;
    if (entityId) entityIds.add(entityId);
  });

  (config.geolocation_sources || []).forEach(src => {
    Object.keys(states).forEach(entityId => {
      if (entityId.startsWith("geo_location.") && states[entityId].attributes?.source === src) {
        entityIds.add(entityId);
      }
    });
  });

  (config.include_domains || []).forEach(d => {
    Object.keys(states).forEach(entityId => {
      if (entityId.startsWith(d + ".")) entityIds.add(entityId);
    });
  });

  return entityIds;
};

const statesEqual = (prevStates, currStates, entityIds) => {
  for (const entityId of entityIds) {
    const prev = prevStates[entityId];
    const curr = currStates[entityId];
    if (!prev && !curr) continue;
    if (!prev || !curr) return false;
    if (prev.state !== curr.state) return false;
    const prevAttrs = prev.attributes || {};
    const currAttrs = curr.attributes || {};
    if (prevAttrs.latitude !== currAttrs.latitude) return false;
    if (prevAttrs.longitude !== currAttrs.longitude) return false;
    if (prevAttrs.gps_accuracy !== currAttrs.gps_accuracy) return false;
    if (prevAttrs.source !== currAttrs.source) return false;
  }
  return true;
};

const isValidCoordinate = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

class OpenmapCard extends LitElement {
  static properties = {
    hass: { type: Object },
    config: { type: Object },
    _isPreview: { state: true },
  };

  static getConfigElement() {
    return document.createElement("openmap-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Open Map",
      default_zoom: 7,
      center_lat: undefined,
      center_lon: undefined,
      dark_mode: "auto",
      entities: [],
      geolocation_sources: [],
      include_domains: [],
      attribution: "",
      marker: { color: { default: "red" }, popup: {} },
    };
  }

  constructor() {
    super();
    this.config = {};
    this._map = null;
    this._markerGroup = null;
    this._tileLayer = null;
    this._isPanel = false;
    this._ready = false;
    this._connected = false;
    this._isPreview = false;
    this._prevRelevantStates = {};
    this._renderMarkersDebounced = debounce(this._renderMarkers.bind(this), 150);
    this._resizeObserver = null;
    this._visibilityObserver = null;
    this._debug = _isDebugFromUrl();
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid config");
    const merged = {
      title: "", entities: [], geolocation_sources: [], include_domains: [],
      default_zoom: DEFAULT_ZOOM, center: null, dark_mode: "auto",
      attribution: "", marker: {}, ...config,
    };
    if (config.center_lat !== undefined && config.center_lon !== undefined) {
      const lat = Number(config.center_lat);
      const lon = Number(config.center_lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        merged.center = [lat, lon];
      }
    }
    this.config = merged;
    this._prevRelevantStates = {};
    if (this._map) this._map.invalidateSize();
  }

  set panel(val) {
    this._isPanel = true;
    this.setConfig(val.config || {});
    this._tryInit();
  }

  set narrow(val) {}
  set route(val) {}

  getCardSize() {
    return 4;
  }

  getLayoutOptions() {
    return { grid_columns: 4, grid_rows: 2 };
  }

  _isInPreviewContext() {
    let el = this.parentElement;
    while (el) {
      const tag = (el.tagName || "").toLowerCase();
      if (
        tag === "hui-card-picker" ||
        tag === "hui-dialog-create-card" ||
        tag === "hui-card-preview"
      ) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._debug = _isDebugFromUrl();
    if (this._debug) window.__OPENMAP_DEBUG = true;
    this._connected = true;
    // Guard: in card-picker preview, do no async work so the picker can
    // tear the preview down without racing our microtasks.
    this._isPreview = this._isInPreviewContext();
    if (this._isPreview) return;
    if (this._isPanel) {
      this._tryInit();
      return;
    }
    this._showLoading();
    queueMicrotask(() => this._initMap());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._connected = false;
    this._isPreview = false;
    this._renderMarkersDebounced?.cancel();
    if (this._map) {
      this._map.off("resize");
      if (this._tileLayer) {
        this._map.removeLayer(this._tileLayer);
        this._tileLayer = null;
      }
      this._map.remove();
      this._map = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._visibilityObserver) {
      this._visibilityObserver.disconnect();
      this._visibilityObserver = null;
    }
    this._markerGroup = null;
    this._ready = false;
  }

  updated(changed) {
    if (this._isPreview) return;
    if (changed.has("hass") && this.hass && this._map) {
      const relevantEntityIds = getRelevantEntityIds(this.config, this.hass);
      const curr = {};
      relevantEntityIds.forEach(id => { curr[id] = this.hass.states[id]; });
      if (this._prevRelevantStates &&
          statesEqual(this._prevRelevantStates, curr, relevantEntityIds)) {
        return;
      }
      this._prevRelevantStates = curr;
      this._renderMarkersDebounced();
    }
  }

  _tryInit() {
    if (!this._isPanel || !this.hass || this._ready) return;
    this._ready = true;
    this._connected = true;
    this._showLoading();
    queueMicrotask(() => this._initMap());
  }

  _getDefaultCenter() {
    const lat = this.hass?.config?.latitude;
    const lon = this.hass?.config?.longitude;
    if (typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon)) {
      return [lat, lon];
    }
    return DEFAULT_CENTER;
  }

  _initMap() {
    if (this._isPreview) return;
    if (this._map) return;
    const container = this.shadowRoot?.getElementById("map");
    if (!container) {
      _dlog("init", "no #map container, aborting");
      return;
    }
    const rect = container.getBoundingClientRect();
    if (rect.width < MIN_SIZE_W || rect.height < MIN_SIZE_H) {
      _dlog("init", "container too small, waiting", { w: rect.width, h: rect.height });
      return;
    }

    // Disconnect any stale observers before (re)init.
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._visibilityObserver) {
      this._visibilityObserver.disconnect();
      this._visibilityObserver = null;
    }

    const cfg = this.config;
    const center = cfg.center ?? this._getDefaultCenter();
    const zoom = cfg.default_zoom || DEFAULT_ZOOM;
    _dlog("init", "creating map", { center, zoom, size: rect });

    try {
      this._map = L.map(container, {
        crs: L.CRS.EPSG3857,
        center,
        zoom,
        zoomControl: true,
        attributionControl: true,
      });
    } catch (e) {
      this._map = null;
      _dlog("init", "Leaflet map init failed", e);
      this._showError(`Map init failed: ${e?.message || e}`);
      return;
    }

    try {
      this._addTileLayer();
      this._markerGroup = L.layerGroup().addTo(this._map);
      this._map.on("resize", () => this._map && this._map.invalidateSize());
    } catch (e) {
      _dlog("init", "tile/layer setup failed", e);
    }

    try {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._map) this._map.invalidateSize();
      });
      this._resizeObserver.observe(container);

      this._visibilityObserver = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting && this._map) {
          this._map.invalidateSize();
        }
      });
      this._visibilityObserver.observe(container);
    } catch (e) {
      _dlog("init", "observer setup failed", e);
    }

    setTimeout(() => this._map && this._map.invalidateSize(), 200);
    this._renderMarkers();
  }

  _addTileLayer() {
    if (!this._map) return;
    if (this._tileLayer) this._map.removeLayer(this._tileLayer);
    const dark = this._isDark();
    this._tileLayer = L.tileLayer(
      dark ? STADIA_DARK_URL : OSM_URL,
      { maxZoom: 19, attribution: dark ? STADIA_DARK_ATTR : OSM_ATTR, referrerPolicy: "origin" }
    ).addTo(this._map);
  }

  _isDark() {
    const cfg = this.config;
    if (cfg.dark_mode === "dark") return true;
    if (cfg.dark_mode === "light") return false;
    const tc = getComputedStyle(document.documentElement).getPropertyValue("--primary-text-color").trim();
    return tc === "#e1e1e1" || document.body.classList.contains("dark");
  }

  _showLoading(message = "Loading map...") {
    const container = this.shadowRoot?.getElementById("map");
    if (!container) return;
    container.innerHTML = `<div class="om-loading">${esc(message)}</div>`;
  }

  _showError(message) {
    const container = this.shadowRoot?.getElementById("map");
    if (!container) return;
    container.innerHTML = `<div class="om-error">${esc(message)}</div>`;
  }

  _renderMarkers() {
    if (!this._map || !this.hass || !this._markerGroup) return;
    this._markerGroup.clearLayers();
    const cfg = this.config;
    const st = this.hass.states || {};
    const mc = cfg.marker || {};
    const entities = [];

    (cfg.entities || []).forEach(e => {
      if (typeof e === "string") {
        const s = st[e];
        if (s && s.state !== "unavailable" && s.state !== "unknown" && s.attributes.latitude && s.attributes.longitude) {
          entities.push(s);
        }
      } else if (e && e.entity) {
        const s = st[e.entity];
        if (s && s.state !== "unavailable" && s.state !== "unknown" && s.attributes.latitude && s.attributes.longitude) {
          entities.push({ ...s, _custom_name: e.name });
        }
      }
    });

    (cfg.geolocation_sources || []).forEach(src => {
      Object.values(st).forEach(s => {
        if (s.entity_id.startsWith("geo_location.") && s.state !== "unavailable" && s.state !== "unknown" && s.attributes.source === src && s.attributes.latitude) {
          entities.push(s);
        }
      });
    });

    (cfg.include_domains || []).forEach(d => {
      Object.values(st).forEach(s => {
        if (s.entity_id.startsWith(d + ".") && s.state !== "unavailable" && s.state !== "unknown" && s.attributes.latitude && s.attributes.longitude) {
          entities.push(s);
        }
      });
    });

    const seen = new Set();
    entities.forEach(e => {
      if (seen.has(e.entity_id)) return;
      seen.add(e.entity_id);
      const lat = Number(e.attributes.latitude);
      const lon = Number(e.attributes.longitude);
      if (!isValidCoordinate(lat, lon)) return;
      const color = (mc.color && mc.color.default) || "red";
      const icon = L.divIcon({ html: pinSVG(color), className: "", iconSize: [24, 36], iconAnchor: [12, 36], popupAnchor: [0, -36] });
      const marker = L.marker([lat, lon], { icon }).addTo(this._markerGroup);
      const content = this._buildPopup(e, mc.popup || {});
      if (content) marker.bindPopup(content, { closeButton: true, className: "om-popup-container", maxWidth: 350 });
    });
  }

  _buildPopup(state, pc) {
    const title = pc.title ? this._resolve(state, pc.title) : state.attributes.friendly_name || state.entity_id;
    const body = pc.body ? this._resolve(state, pc.body) : "";
    const fields = pc.fields || [{ label: "State", value: "state" }];
    let h = '<div class="om-pop">';
    h += `<h3>${esc(title)}</h3>`;
    fields.forEach(f => {
      let v = this._resolve(state, f.value || f.field || f);
      if (f.format === "number") v = Math.round(parseFloat(v) * 100) / 100;
      if (v != null && v !== "") h += `<div class="om-row"><span class="om-l">${esc(f.label || f.name || f)}</span><span class="om-v">${esc(String(v))}</span></div>`;
    });
    if (body) h += `<div class="om-desc">${esc(body)}</div>`;
    h += "</div>";
    return h;
  }

  _resolve(obj, expr) {
    if (!expr || !obj) return "";
    if (expr === "state") return esc(obj.state);
    if (typeof expr === "string" && expr.indexOf("{") >= 0)
      return expr.replace(/\{(\w+)\}/g, (_, k) => (obj.attributes && obj.attributes[k] !== undefined) ? esc(String(obj.attributes[k])) : `{${k}}`);
    if (obj.attributes && obj.attributes[expr] !== undefined) return esc(String(obj.attributes[expr]));
    return "";
  }

  render() {
    if (this._isPreview) {
      return html`<div class="om-preview">Open Map</div>`;
    }
    const cfg = this.config;
    return html`
      <ha-card>
        ${cfg.title ? html`<h1 class="card-header">${cfg.title}</h1>` : nothing}
        <div class="om-wrap"><div id="map"></div></div>
        ${cfg.attribution ? html`<div class="om-att">${cfg.attribution}</div>` : nothing}
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 300px;
      overflow: hidden;
      box-sizing: border-box;
    }
    #map {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 300px;
      border-radius: var(--ha-card-border-radius, 12px);
      overflow: hidden;
      z-index: 0;
      background: #ddd;
    }
    /* Critical subset of leaflet.css for Shadow DOM */
    #map .leaflet-pane,
    #map .leaflet-tile,
    #map .leaflet-marker-icon,
    #map .leaflet-marker-shadow,
    #map .leaflet-tile-container,
    #map .leaflet-pane > svg,
    #map .leaflet-pane > canvas,
    #map .leaflet-zoom-box,
    #map .leaflet-image-layer,
    #map .leaflet-layer {
      position: absolute;
      left: 0;
      top: 0;
    }
    #map .leaflet-container { overflow: hidden; }
    #map .leaflet-tile-pane    { z-index: 2; }
    #map .leaflet-overlay-pane { z-index: 4; pointer-events: none; }
    #map .leaflet-shadow-pane  { z-index: 5; }
    #map .leaflet-marker-pane  { z-index: 6; }
    #map .leaflet-tooltip-pane { z-index: 7; }
    #map .leaflet-popup-pane   { z-index: 8; }
    #map .leaflet-control { z-index: 800; pointer-events: auto; }
    #map .leaflet-top, #map .leaflet-bottom { z-index: 1000; pointer-events: none; position: absolute; }
    #map .leaflet-top { top: 0; }
    #map .leaflet-right { right: 0; position: absolute; }
    #map .leaflet-bottom { bottom: 0; }
    #map .leaflet-left { left: 0; position: absolute; }
    #map .leaflet-control { float: left; clear: both; pointer-events: auto; }
    #map .leaflet-right .leaflet-control { float: right; }
    #map .leaflet-top .leaflet-control { margin-top: 10px; }
    #map .leaflet-bottom .leaflet-control { margin-bottom: 0; }
    #map .leaflet-left .leaflet-control { margin-left: 10px; }
    #map .leaflet-right .leaflet-control { margin-right: 0; }
    #map .leaflet-control-attribution {
      background: rgba(255, 255, 255, 0.85);
      margin: 0;
      padding: 0 5px;
      color: #333;
      font: 11px/1.5 "Helvetica Neue", Arial, Helvetica, sans-serif;
      box-sizing: border-box;
    }
    #map .leaflet-control-attribution a { text-decoration: none; color: #0078A8; }
    #map .leaflet-control-attribution a:hover { text-decoration: underline; }
    #map .leaflet-control-zoom {
      position: absolute;
      top: 0;
      left: 0;
    }
    #map .leaflet-control-zoom a {
      background-color: rgba(255, 255, 255, 0.85);
      border-bottom: 1px solid #ccc;
      width: 22px;
      height: 22px;
      line-height: 22px;
      display: block;
      text-align: center;
      text-decoration: none;
      color: black;
      font: bold 18px "Helvetica Neue", Arial, Helvetica, sans-serif;
    }
    #map .leaflet-control-zoom a:hover { background-color: #fff; }
    #map .leaflet-control-zoom a:first-child {
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
    }
    #map .leaflet-control-zoom a:last-child {
      border-bottom-left-radius: 4px;
      border-bottom-right-radius: 4px;
      border-bottom: none;
    }
    #map .leaflet-tooltip {
      position: absolute;
      padding: 4px 8px;
      background-color: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      font: 12px/1.4 "Helvetica Neue", Arial, sans-serif;
      color: #333;
    }
    .om-wrap {
      width: 100%;
      height: 100%;
      min-height: 300px;
      border-radius: var(--ha-card-border-radius, 12px);
      overflow: hidden;
      position: relative;
    }
    .om-att {
      font-size: 10px;
      color: var(--secondary-text-color, #999);
      padding: 4px 8px;
      text-align: right;
    }
    .om-pop {
      font-family: var(--primary-font-family, Roboto, sans-serif);
      color: var(--primary-text-color, #333);
      min-width: 200px;
      max-width: 320px;
    }
    .om-pop h3 { font-size: 15px; font-weight: 600; margin: 0 0 6px; }
    .om-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      font-size: 13px;
      border-bottom: 1px solid var(--divider-color, #eee);
    }
    .om-row:last-child { border-bottom: none; }
    .om-l { color: var(--secondary-text-color, #888); margin-right: 8px; }
    .om-v { text-align: right; font-weight: 500; }
    .om-desc {
      margin-top: 8px;
      font-size: 13px;
      line-height: 1.4;
      padding: 8px;
      background: var(--secondary-background-color, #f5f5f5);
      border-radius: 6px;
    }
    .om-loading {
      padding: 16px;
      color: var(--secondary-text-color, #888);
      text-align: center;
      font-family: var(--primary-font-family, Roboto, sans-serif);
    }
    .om-error {
      padding: 16px;
      color: var(--error-color, #d32f2f);
      text-align: center;
      font-family: var(--primary-font-family, Roboto, sans-serif);
    }
    .om-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      min-height: 200px;
      color: var(--secondary-text-color, #666);
      font-size: 14px;
    }
  `;
}

try {
  customElements.define("openmap-card", OpenmapCard);
} catch (e) {
  _dwarn("define", `openmap-card already defined: ${e}`);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "openmap-card",
  name: "Open Map Card",
  description: "Extensible replacement for the built-in Home Assistant map card",
  preview: false,
  documentationURL: "https://github.com/your-username/openmap",
});

export { OpenmapCard };
