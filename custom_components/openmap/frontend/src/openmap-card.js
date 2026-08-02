import { LitElement, html, css, nothing } from "lit";
import L from "./leaflet-shim.js";
import "leaflet.markercluster";
import "./openmap-card-editor.js";

const CARD_VERSION = "0.2.6";

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

// Match Home Assistant's built-in map card: CARTO Voyager tiles in both
// light and dark mode (dark mode is applied via a CSS filter, not a
// separate tile layer).
const MAP_URL = "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const MAP_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>';
const MAP_OPTIONS = {
  subdomains: "abcd",
  minZoom: 0,
  maxZoom: 20,
  referrerPolicy: "origin",
};

const DEFAULT_CENTER = [48.8, 9.2];
const DEFAULT_ZOOM = 14; // HA map card default
const MIN_SIZE_W = 200;
const MIN_SIZE_H = 100;

const NAMED_COLORS = {
  red: "#F44336",
  orange: "#FF9800",
  green: "#4CAF50",
  blue: "#2196F3",
  purple: "#9C27B0",
  default: "#F44336",
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

const parseAspectRatio = (ar) => {
  if (typeof ar !== "string") return null;
  const parts = ar.split(":").map(Number);
  if (parts.length !== 2 || parts.some(isNaN) || parts.some((p) => p <= 0)) return null;
  return { w: parts[0], h: parts[1] };
};

const colorToHex = (color) => NAMED_COLORS[color] || color || "#F44336";

const resolveMarkerColor = (configMarker, entityColor) => {
  if (entityColor) return colorToHex(entityColor);
  const def = configMarker?.color?.default || "default";
  return colorToHex(def);
};

class OpenmapCard extends LitElement {
  static properties = {
    hass: { type: Object },
    config: { type: Object },
    layout: { type: String, reflect: true },
    _isPreview: { state: true },
  };

  static getConfigElement() {
    return document.createElement("openmap-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Open Map",
      default_zoom: DEFAULT_ZOOM,
      center_lat: undefined,
      center_lon: undefined,
      theme_mode: "auto",
      cluster: true,
      entities: [],
      geo_location_sources: [],
      include_domains: [],
      attribution: "",
      marker: {
        color: { default: "default" },
        size: 48,
        label_mode: "initials",
        popup: {},
      },
    };
  }

  constructor() {
    super();
    this.config = {};
    this.layout = "";
    this._map = null;
    this._markerLayer = null;
    this._tileLayer = null;
    this._isPanel = false;
    this._ready = false;
    this._connected = false;
    this._isPreview = false;
    this._prevRelevantStates = {};
    this._renderMarkersDebounced = debounce(this._renderMarkers.bind(this), 150);
    this._invalidateDebounced = debounce(() => this._invalidateSize(), 100);
    this._resizeObserver = null;
    this._visibilityObserver = null;
    this._mapNode = null;
    this._debug = _isDebugFromUrl();
  }

  // The Leaflet container is created imperatively and kept OUTSIDE the Lit
  // template so re-renders (theme changes, config edits) can never orphan the
  // map instance (matches Home Assistant's own ha-map implementation).
  _ensureMapContainer() {
    const root = this.shadowRoot?.getElementById("root");
    if (!root) return null;
    let map = root.querySelector("#map");
    if (!map) {
      map = document.createElement("div");
      map.id = "map";
      root.appendChild(map);
    }
    return map;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid config");
    const merged = {
      title: "", entities: [], geo_location_sources: [], include_domains: [],
      default_zoom: DEFAULT_ZOOM, center: null, theme_mode: "auto",
      cluster: true, attribution: "", marker: {}, ...config,
    };
    // Backwards-compatible alias
    if (merged.dark_mode && !merged.theme_mode) {
      merged.theme_mode = merged.dark_mode;
    }
    // Backwards-compatible alias for geo_location_sources
    if (!merged.geo_location_sources && merged.geolocation_sources) {
      merged.geo_location_sources = merged.geolocation_sources;
    }
    // Only treat center as configured when both values are non-empty and
    // parse to finite numbers. Empty strings must NOT become [0, 0]
    // (Number("") === 0), which previously moved the map to the ocean.
    if (config.center_lat !== undefined && config.center_lon !== undefined) {
      const latStr = String(config.center_lat).trim();
      const lonStr = String(config.center_lon).trim();
      if (latStr !== "" && lonStr !== "") {
        const lat = Number(latStr);
        const lon = Number(lonStr);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          merged.center = [lat, lon];
        }
      }
    }
    this.config = merged;
    this._prevRelevantStates = {};
    if (this._map) {
      this._map.invalidateSize();
      this._updateMapStyle();
    }
    this.requestUpdate();
  }

  set panel(val) {
    this._isPanel = true;
    this.setConfig(val.config || {});
    this._tryInit();
  }

  set narrow(val) {}
  set route(val) {}

  getCardSize() {
    if (!this.config?.aspect_ratio) return 7;
    const ratio = parseAspectRatio(this.config.aspect_ratio);
    const ar =
      ratio && ratio.w > 0 && ratio.h > 0
        ? `${((100 * ratio.h) / ratio.w).toFixed(2)}`
        : "100";
    return 1 + Math.floor(Number(ar) / 25) || 3;
  }

  getGridOptions() {
    return {
      columns: "full",
      rows: 4,
      min_columns: 6,
      min_rows: 2,
    };
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
    this._isPreview = this._isInPreviewContext();
    if (this._isPreview) return;

    if (!this._resizeObserver) {
      try {
        this._resizeObserver = new ResizeObserver(() => {
          if (!this._map) {
            this._initMap();
          } else {
            this._invalidateDebounced();
          }
        });
        this._resizeObserver.observe(this._ensureMapContainer() || this);
      } catch (e) {
        _dlog("connect", "ResizeObserver setup failed", e);
      }
    }

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
    this._markerLayer = null;
    this._mapNode = null;
    this._ready = false;
  }

  updated(changed) {
    if (this._isPreview) return;
    if (changed.has("hass")) {
      if (this._isPanel && !this._ready && this.hass) {
        this._tryInit();
        return;
      }
      // Live theme changes (light <-> dark) should re-apply the map style
      // and force a tile redraw so the map never collapses to a solid color.
      const oldTheme = changed.get("hass")?.themes?.darkMode;
      if (this.hass && oldTheme !== this.hass.themes?.darkMode && this._map) {
        this._updateMapStyle();
        this._refreshTiles();
      }
    }
    if (changed.has("config")) {
      this._computePadding();
    }
    // Diagnostic: confirm the Leaflet container survives re-renders. If the
    // node identity ever changes the map would be orphaned (solid-color map).
    if (this._map && this._mapNode) {
      const current = this._ensureMapContainer();
      if (current !== this._mapNode) {
        _dlog("map-node", "container node replaced during update; re-initializing");
        this._mapNode = current;
        if (this._map) {
          this._map.remove();
          this._map = null;
          this._markerLayer = null;
          this._tileLayer = null;
        }
        this._initMap();
      }
    }
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

  _countEntities() {
    if (!this.hass) return 0;
    const seen = new Set();
    this._gatherEntities().forEach(({ state }) => {
      if (!state.entity_id.startsWith("zone.")) seen.add(state.entity_id);
    });
    return seen.size;
  }

  _fitToFocus() {
    if (!this._map) return;
    const positions = this._gatherEntities()
      .map(({ state }) => [
        Number(state.attributes.latitude),
        Number(state.attributes.longitude),
      ])
      .filter((p) => isValidCoordinate(p[0], p[1]));
    if (positions.length) {
      try {
        this._map.fitBounds(L.latLngBounds(positions).pad(0.3), {
          maxZoom: this.config.default_zoom || DEFAULT_ZOOM,
        });
        return;
      } catch (e) {
        _dlog("focus", "fitBounds failed", e);
      }
    }
    const center = this.config.center ?? this._getDefaultCenter();
    this._map.setView(center, this.config.default_zoom || DEFAULT_ZOOM);
  }

  _toggleCluster() {
    this.config = { ...this.config, cluster: !this.config.cluster };
    this._renderMarkers();
    this.requestUpdate();
  }

  get _darkMode() {
    const mode = this.config?.theme_mode || "auto";
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return Boolean(this.hass?.themes?.darkMode);
  }

  _updateMapStyle() {
    const map = this._ensureMapContainer();
    if (!map) return;
    const dark = this._darkMode;
    const isPanel = this._isPanel || this.layout === "panel";
    map.classList.toggle("dark", dark);
    map.classList.toggle("forced-dark", this.config?.theme_mode === "dark");
    map.classList.toggle("forced-light", this.config?.theme_mode === "light");
    map.classList.toggle("panel", isPanel);
    // Deterministically apply the dark tile filter for auto+dark too
    // (matches HA's dark map appearance without relying on class state).
    map.style.setProperty(
      "--map-filter",
      dark
        ? "invert(0.9) hue-rotate(170deg) brightness(1.5) contrast(1.2) saturate(0.3)"
        : "invert(0)"
    );
  }

  _invalidateSize() {
    if (!this._map) return;
    let size;
    try {
      size = this._map.getSize();
    } catch (e) {
      return;
    }
    if (!size || size.x === 0 || size.y === 0) {
      // Container not laid out yet; retry a few times (theme changes can
      // briefly zero the size, which would otherwise make Leaflet drop all
      // tiles). Cap retries so hidden tabs don't loop forever.
      this._invalidateRetries = (this._invalidateRetries || 0) + 1;
      if (this._invalidateRetries > 40) {
        this._invalidateRetries = 0;
        return;
      }
      setTimeout(() => this._invalidateSize(), 150);
      return;
    }
    this._invalidateRetries = 0;
    this._map.invalidateSize({ debounceMoveend: true });
  }

  _refreshTiles() {
    if (!this._map) return;
    setTimeout(() => {
      if (!this._map) return;
      try {
        this._map.invalidateSize({ debounceMoveend: true });
        if (this._tileLayer && typeof this._tileLayer.redraw === "function") {
          this._tileLayer.redraw();
        }
      } catch (e) {
        _dlog("tiles", "refresh failed", e);
      }
    }, 50);
  }

  _computePadding() {
    const root = this.shadowRoot?.getElementById("root");
    const ignoreAspectRatio =
      this.layout === "panel" || this.layout === "grid" || this._isPanel;
    if (!this.config || ignoreAspectRatio || !root) return;
    if (!this.config.aspect_ratio) {
      root.style.paddingBottom = "100%";
      return;
    }
    root.style.height = "auto";
    const ratio = parseAspectRatio(this.config.aspect_ratio);
    root.style.paddingBottom =
      ratio && ratio.w > 0 && ratio.h > 0
        ? `${((100 * ratio.h) / ratio.w).toFixed(2)}%`
        : (root.style.paddingBottom = "100%");
  }

  _initMap() {
    if (this._isPreview) return;
    if (this._map) return;
    const container = this._ensureMapContainer();
    if (!container) {
      _dlog("init", "no #map container, aborting");
      return;
    }
    this._mapNode = container;
    const rect = container.getBoundingClientRect();
    if (rect.width < MIN_SIZE_W || rect.height < MIN_SIZE_H) {
      _dlog("init", "container too small, waiting", { w: rect.width, h: rect.height });
      return;
    }

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
      this._map.on("resize", () => this._invalidateSize());
      this._updateMapStyle();
    } catch (e) {
      _dlog("init", "tile/layer setup failed", e);
    }

    try {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._map) this._invalidateDebounced();
      });
      this._resizeObserver.observe(container);

      this._visibilityObserver = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting && this._map) {
          this._invalidateSize();
        }
      });
      this._visibilityObserver.observe(container);
    } catch (e) {
      _dlog("init", "observer setup failed", e);
    }

    setTimeout(() => this._invalidateSize(), 200);
    this._renderMarkers();
  }

  _addTileLayer() {
    if (!this._map) return;
    if (this._tileLayer) this._map.removeLayer(this._tileLayer);
    this._tileLayer = L.tileLayer(MAP_URL, {
      ...MAP_OPTIONS,
      attribution: MAP_ATTR,
    }).addTo(this._map);
  }

  _showLoading(message = "Loading map...") {
    const container = this._ensureMapContainer();
    if (!container) return;
    container.innerHTML = `<div class="om-loading">${esc(message)}</div>`;
  }

  _showError(message) {
    const container = this._ensureMapContainer();
    if (!container) return;
    container.innerHTML = `<div class="om-error">${esc(message)}</div>`;
  }

  _gatherEntities() {
    const cfg = this.config;
    const st = this.hass.states || {};
    const entities = [];

    (cfg.entities || []).forEach(e => {
      if (typeof e === "string") {
        const s = st[e];
        if (s && s.state !== "unavailable" && s.state !== "unknown" && s.attributes.latitude && s.attributes.longitude) {
          entities.push({ state: s, color: null, name: null });
        }
      } else if (e && e.entity) {
        const s = st[e.entity];
        if (s && s.state !== "unavailable" && s.state !== "unknown" && s.attributes.latitude && s.attributes.longitude) {
          entities.push({ state: { ...s, _custom_name: e.name }, color: e.color, name: e.name });
        }
      }
    });

    (cfg.geo_location_sources || cfg.geolocation_sources || []).forEach(src => {
      Object.values(st).forEach(s => {
        if (s.entity_id.startsWith("geo_location.") && s.state !== "unavailable" && s.state !== "unknown" && s.attributes.source === src && s.attributes.latitude) {
          entities.push({ state: s, color: null, name: null });
        }
      });
    });

    (cfg.include_domains || []).forEach(d => {
      Object.values(st).forEach(s => {
        if (s.entity_id.startsWith(d + ".") && s.state !== "unavailable" && s.state !== "unknown" && s.attributes.latitude && s.attributes.longitude) {
          entities.push({ state: s, color: null, name: null });
        }
      });
    });

    return entities;
  }

  _markerLabel(state, customName, mc) {
    const labelMode = mc.label_mode || "initials";
    const name = customName || state.attributes.friendly_name || state.entity_id;
    if (labelMode === "name") return name;
    if (labelMode === "state") return state.state || "";
    if (labelMode === "attribute") {
      const attr = mc.attribute || mc.attr || "state";
      const v = state.attributes?.[attr];
      return v != null ? String(v) : "";
    }
    if (labelMode === "icon") return null; // icon handled separately
    // initials (default, matches HA)
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .substring(0, 3);
  }

  _markerIconHTML(state, customName, color, mc, markerSize) {
    const labelMode = mc.label_mode || "initials";
    let inner = "";
    if (labelMode === "icon") {
      const icon = state.attributes?.icon;
      inner = icon
        ? `<ha-icon icon="${esc(icon)}" style="--mdc-icon-size:${Math.round(markerSize / 2)}px;"></ha-icon>`
        : this._markerLabel(state, customName, mc);
    } else {
      const label = this._markerLabel(state, customName, mc);
      inner = label
        ? `<span>${esc(label)}</span>`
        : "";
    }
    const fontSize = mc.font_size || `calc(${markerSize}px * 0.42)`;
    return `<div class="om-marker" style="--marker-size:${markerSize}px;--marker-color:${esc(color)};font-size:${esc(fontSize)};">${inner}</div>`;
  }

  _buildMarker(state, customName, color, mc) {
    const markerSize = Number(mc.size) || 48;
    const html = this._markerIconHTML(state, customName, color, mc, markerSize);
    const icon = L.divIcon({
      html,
      className: "",
      iconSize: [markerSize, markerSize],
      iconAnchor: [markerSize / 2, markerSize / 2],
      popupAnchor: [0, -markerSize / 2],
    });
    const marker = L.marker([Number(state.attributes.latitude), Number(state.attributes.longitude)], { icon });
    const content = this._buildPopup(state, mc.popup || {});
    if (content) marker.bindPopup(content, { closeButton: true, className: "om-popup-container", maxWidth: 350 });
    return marker;
  }

  _buildZone(state, color) {
    const radius = Number(state.attributes.radius) || 100;
    const circle = L.circle([Number(state.attributes.latitude), Number(state.attributes.longitude)], {
      interactive: false,
      color,
      radius,
    });
    return circle;
  }

  _renderMarkers() {
    if (!this._map || !this.hass) return;

    if (this._markerLayer) {
      this._map.removeLayer(this._markerLayer);
      this._markerLayer = null;
    }

    const cfg = this.config;
    const mc = cfg.marker || {};
    const themeColor = getComputedStyle(this).getPropertyValue("--accent-color")?.trim() || "#03a9f4";
    const darkPrimary = getComputedStyle(this).getPropertyValue("--dark-primary-color")?.trim() || "#2196F3";

    const entities = this._gatherEntities();
    const seen = new Set();
    const markers = [];
    const zones = [];

    entities.forEach(({ state, color, name }) => {
      if (seen.has(state.entity_id)) return;
      seen.add(state.entity_id);
      const lat = Number(state.attributes.latitude);
      const lon = Number(state.attributes.longitude);
      if (!isValidCoordinate(lat, lon)) return;
      const markerColor = resolveMarkerColor(mc, color);
      if (state.entity_id.startsWith("zone.")) {
        zones.push(this._buildZone(state, themeColor));
        return;
      }
      markers.push(this._buildMarker(state, name, markerColor, mc));
      // gps accuracy ring (matches HA)
      if (state.attributes.gps_accuracy) {
        markers.push(
          L.circle([lat, lon], {
            interactive: false,
            color: darkPrimary,
            radius: Number(state.attributes.gps_accuracy),
          })
        );
      }
    });

    if (cfg.cluster !== false && markers.length) {
      const maxClusterRadius = Number(cfg.cluster_radius) || 40;
      this._markerLayer = L.markerClusterGroup({
        showCoverageOnHover: false,
        removeOutsideVisibleBounds: false,
        maxClusterRadius,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          const cls = count < 10 ? "small" : count < 100 ? "medium" : "large";
          return L.divIcon({
            html: `<div><span>${count}</span></div>`,
            className: `marker-cluster ${cls}`,
            iconSize: L.point(40, 40),
          });
        },
      });
      this._markerLayer.addLayers(markers);
    } else {
      this._markerLayer = L.layerGroup(markers);
    }
    this._map.addLayer(this._markerLayer);
    zones.forEach((z) => z.addTo(this._map));
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
    const isPanel = this._isPanel || this.layout === "panel";
    const entityCount = this._countEntities();
    const btnColor = this._darkMode ? "#ffffff" : "#000000";
    const controls = html`
      <div id="buttons">
        ${entityCount > 1
          ? html`
              <button
                class="om-map-btn"
                style="color:${btnColor}"
                title="Toggle grouping"
                @click=${this._toggleCluster}
              >
                <ha-icon
                  icon=${this.config.cluster !== false
                    ? "mdi:google-circles-communities"
                    : "mdi:dots-hexagon"}
                ></ha-icon>
              </button>
            `
          : nothing}
        <button
          class="om-map-btn"
          style="color:${btnColor}"
          title="Reset focus"
          @click=${this._fitToFocus}
        >
          <ha-icon icon="mdi:image-filter-center-focus"></ha-icon>
        </button>
      </div>
    `;
    if (isPanel) {
      // Fullscreen panel: no card frame, no rounded corners.
      return html`<div id="root">${controls}</div>`;
    }
    return html`
      <ha-card>
        ${cfg.title ? html`<h1 class="card-header">${cfg.title}</h1>` : nothing}
        <div id="root">${controls}</div>
        ${cfg.attribution ? html`<div class="om-att">${cfg.attribution}</div>` : nothing}
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }
    ha-card {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #root {
      position: relative;
      height: 100%;
      flex: 1 1 auto;
      overflow: hidden;
    }
    #map {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg));
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
    #map .leaflet-pane { z-index: 0 !important; }
    #map .leaflet-tile-pane    { z-index: 2; }
    #map .leaflet-overlay-pane { z-index: 4; pointer-events: none; }
    #map .leaflet-shadow-pane  { z-index: 5; }
    #map .leaflet-marker-pane  { z-index: 6; }
    #map .leaflet-tooltip-pane { z-index: 7; }
    #map .leaflet-popup-pane   { z-index: 8; }
    #map .leaflet-control,
    #map .leaflet-top,
    #map .leaflet-bottom {
      z-index: 1 !important;
      pointer-events: auto;
      position: absolute;
    }
    #map .leaflet-top { top: 0; }
    #map .leaflet-right { right: 0; }
    #map .leaflet-bottom { bottom: 0; }
    #map .leaflet-left { left: 0; }
    #map .leaflet-control { float: left; clear: both; }
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
    /* Square corners on the side control; rounding is applied by the card
       container (#map) so only the dashboard element shows rounded corners. */
    #map .leaflet-control-zoom a:first-child,
    #map .leaflet-control-zoom a:last-child {
      border-radius: 0;
    }
    #map .leaflet-control-zoom a:last-child {
      border-bottom: none;
    }
    #map.panel {
      border-radius: 0;
    }
    #buttons {
      position: absolute;
      top: 75px;
      left: 3px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 1001;
    }
    .om-map-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
      border-radius: 4px;
      background: var(--card-background-color, rgba(255, 255, 255, 0.9));
      color: var(--primary-text-color);
      cursor: pointer;
      padding: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
    .om-map-btn:hover {
      background: var(--secondary-background-color, #fff);
    }
    .om-map-btn ha-icon {
      --mdc-icon-size: 20px;
    }
    #map .leaflet-tooltip {
      padding: 8px;
      font-size: var(--ha-font-size-s);
      background: rgba(80, 80, 80, 0.9) !important;
      color: white !important;
      border-radius: var(--ha-border-radius-sm);
      box-shadow: none !important;
      text-align: center;
    }

    /* --- Dark mode: CSS filter over the SAME CARTO tiles (matches HA) --- */
    #map .leaflet-tile-pane {
      filter: var(--map-filter);
    }
    #map.dark {
      background: #090909;
    }
    #map.forced-dark {
      color: #ffffff;
      --map-filter: invert(0.9) hue-rotate(170deg) brightness(1.5) contrast(1.2) saturate(0.3);
    }
    #map.forced-light {
      background: #ffffff;
      color: #000000;
      --map-filter: invert(0);
    }
    #map.dark .leaflet-bar a {
      background-color: #1c1c1c;
      color: #ffffff;
    }
    #map.dark .leaflet-bar a:hover {
      background-color: #313131;
    }
    #map.dark .leaflet-control-attribution {
      background: rgba(28, 28, 28, 0.85);
      color: #ffffff;
    }
    #map.dark .leaflet-control-attribution a { color: #81d4fa; }

    /* --- HA-style circular markers (customizable) --- */
    .om-marker {
      display: flex;
      justify-content: center;
      text-align: center;
      align-items: center;
      box-sizing: border-box;
      width: var(--marker-size, 48px);
      height: var(--marker-size, 48px);
      font-weight: 500;
      border-radius: 50%;
      border: 1px solid var(--marker-color, var(--primary-color));
      color: var(--primary-text-color);
      background-color: var(--card-background-color);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    /* --- Cluster styling (matches HA) --- */
    .marker-cluster div {
      background-clip: padding-box;
      background-color: var(--primary-color);
      border: 3px solid rgba(var(--rgb-primary-color), 0.2);
      width: calc(var(--ha-marker-size, 48px) * 0.667);
      height: calc(var(--ha-marker-size, 48px) * 0.667);
      border-radius: 50%;
      text-align: center;
      align-content: center;
      color: var(--text-primary-color);
      font-size: var(--ha-font-size-m);
    }
    .marker-cluster span {
      line-height: var(--ha-line-height-expanded);
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

if (!customElements.get("openmap-card")) {
  customElements.define("openmap-card", OpenmapCard);
} else {
  _dwarn(
    "define",
    "openmap-card already defined by another script (possible stale HACS resource). " +
    "Remove old openmap resources from Lovelace."
  );
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
