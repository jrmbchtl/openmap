const OpenMapCard = (() => {
  const VERSION = "0.2.1";
  const LEAFLET_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
  const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

  let leafletLoadPromise = null;
  let leafletLoadError = null;

  function loadLeaflet(retries = 3) {
    if (leafletLoadPromise) {
      return leafletLoadPromise;
    }

    if (window.L) {
      return Promise.resolve(window.L);
    }

    leafletLoadPromise = new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="leaflet.js"]')) {
        const checkLeaflet = setInterval(() => {
          if (window.L) {
            clearInterval(checkLeaflet);
            resolve(window.L);
          }
        }, 50);
        setTimeout(() => {
          clearInterval(checkLeaflet);
          if (!window.L) reject(new Error("Leaflet failed to load"));
        }, 10000);
        return;
      }

      if (!document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = LEAFLET_CSS_URL;
        link.onerror = () => reject(new Error("Failed to load Leaflet CSS"));
        document.head.appendChild(link);
      }

      const script = document.createElement("script");
      script.src = LEAFLET_URL + ".js";
      script.onload = () => {
        if (window.L) {
          resolve(window.L);
        } else {
          reject(new Error("Leaflet script loaded but L not defined"));
        }
      };
      script.onerror = () => {
        if (retries > 0) {
          setTimeout(() => {
            leafletLoadPromise = null;
            loadLeaflet(retries - 1).then(resolve).catch(reject);
          }, 1000 * (4 - retries));
        } else {
          reject(new Error("Failed to load Leaflet JS after retries"));
        }
      };
      document.head.appendChild(script);
    });

    leafletLoadPromise.catch((err) => {
      leafletLoadError = err;
      leafletLoadPromise = null;
    });

    return leafletLoadPromise;
  }

  function pinSVG(c) {
    const m = { red: "#F44336", orange: "#FF9800", green: "#4CAF50", blue: "#2196F3", purple: "#9C27B0" };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${m[c]||"#F44336"}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>`;
  }

  function esc(s) {
    if (s == null) return "";
    if (typeof s === "object") s = JSON.stringify(s);
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function debounce(fn, delay) {
    let timeoutId;
    const debounced = (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
    debounced.cancel = () => clearTimeout(timeoutId);
    return debounced;
  }

  function getRelevantEntityIds(config, hass) {
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
        if (entityId.startsWith(d + ".")) {
          entityIds.add(entityId);
        }
      });
    });

    return entityIds;
  }

  function statesEqual(prevStates, currStates, entityIds) {
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
  }

  function isValidCoordinate(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  const styleId = "openmap-card-styles";
  function injectStyles() {
    if (document.getElementById(styleId)) return;
    const css = document.createElement("style");
    css.id = styleId;
    css.textContent = `
      openmap-card { display:block; height:100%; }
      .om-panel { width:100%; height:100vh; position:relative; }
      .om-wrap { width:100%; height:100%; min-height:400px; border-radius:var(--ha-card-border-radius,12px); overflow:hidden; position:relative; }
      .om-map { width:100%; height:100%; min-height:400px; }
      .om-pop { font-family:var(--primary-font-family,Roboto,sans-serif); color:var(--primary-text-color,#333); min-width:200px; max-width:320px; }
      .om-pop h3 { font-size:15px; font-weight:600; margin:0 0 6px; }
      .om-row { display:flex; justify-content:space-between; padding:3px 0; font-size:13px; border-bottom:1px solid var(--divider-color,#eee); }
      .om-row:last-child { border-bottom:none; }
      .om-l { color:var(--secondary-text-color,#888); margin-right:8px; }
      .om-v { text-align:right; font-weight:500; }
      .om-desc { margin-top:8px; font-size:13px; line-height:1.4; padding:8px; background:var(--secondary-background-color,#f5f5f5); border-radius:6px; }
      .om-att { font-size:10px; color:var(--secondary-text-color,#999); padding:4px 8px; text-align:right; }
      .om-error { padding: 16px; color: var(--error-color, #d32f2f); text-align: center; font-family: var(--primary-font-family, Roboto, sans-serif); }
      .om-loading { padding: 16px; color: var(--secondary-text-color, #888); text-align: center; font-family: var(--primary-font-family, Roboto, sans-serif); }
    `;
    document.head.appendChild(css);
  }

  class OpenmapCard extends HTMLElement {
    constructor() {
      super();
      this._config = {};
      this._map = null;
      this._markerGroup = null;
      this._tileLayer = null;
      this._L = null;
      this._isPanel = false;
      this._ready = false;
      this._hass = null;
      this._connected = false;
      this._prevRelevantStates = {};
      this._renderMarkersDebounced = debounce(this._renderMarkers.bind(this), 150);
      this._resizeObserver = null;
      this._visibilityObserver = null;
      injectStyles();
    }

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
        marker: {
          color: { default: "red" },
          popup: {}
        }
      };
    }

    _applyDefaultConfig(rawConfig) {
      const merged = {
        title: "", entities: [], geolocation_sources: [], include_domains: [],
        default_zoom: 7, center: null, dark_mode: "auto",
        attribution: "", marker: {}, ...rawConfig
      };
      if (rawConfig.center_lat !== undefined && rawConfig.center_lon !== undefined) {
        const lat = Number(rawConfig.center_lat);
        const lon = Number(rawConfig.center_lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          merged.center = [lat, lon];
        }
      }
      this._prevRelevantStates = {};
      return merged;
    }

    setConfig(config) {
      if (!config || typeof config !== "object") throw new Error("Invalid config");
      this._isPanel = false;
      this._config = this._applyDefaultConfig(config);
      this._render();
      if (this._map) setTimeout(() => this._map.invalidateSize(), 100);
    }

    set panel(val) {
      this._isPanel = true;
      this._config = this._applyDefaultConfig(val.config || {});
      this._tryInit();
    }

    set narrow(val) {}
    set route(val) {}

    set hass(hass) {
      const prevHass = this._hass;
      this._hass = hass;

      if (this._isPanel) {
        if (!this._ready && hass) {
          this._tryInit();
        }
        return;
      }

      if (!this._map || !this._L || !hass) return;

      const relevantEntityIds = getRelevantEntityIds(this._config, hass);
      const currRelevantStates = {};
      relevantEntityIds.forEach(id => { currRelevantStates[id] = hass.states[id]; });

      if (prevHass && statesEqual(this._prevRelevantStates, currRelevantStates, relevantEntityIds)) {
        return;
      }

      this._prevRelevantStates = currRelevantStates;
      this._renderMarkersDebounced();
    }

    get hass() { return this._hass; }

    getCardSize() { return 4; }

    _tryInit() {
      if (!this._isPanel || !this._hass || this._ready) return;
      this._ready = true;
      this._render();
      this._showLoading();
      loadLeaflet()
        .then(L => {
          if (!this._connected) return;
          this._L = L;
          this._initMap();
        })
        .catch(err => {
          if (!this._connected) return;
          this._showError(`Failed to load map: ${err.message}`);
        });
    }

    connectedCallback() {
      if (this._isPanel) return;
      this._connected = true;
      this._render();
      this._showLoading();
      loadLeaflet()
        .then(L => {
          if (!this._connected) return;
          this._L = L;
          this._initMap();
        })
        .catch(err => {
          if (!this._connected) return;
          this._showError(`Failed to load map: ${err.message}`);
        });
    }

    disconnectedCallback() {
      this._connected = false;
      if (this._renderMarkersDebounced?.cancel) this._renderMarkersDebounced.cancel();

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
      this._L = null;
      this._ready = false;
    }

    _render() {
      if (this._isPanel) {
        this.innerHTML = '<div class="om-panel"><div class="om-map"></div></div>';
      } else {
        this.innerHTML = `
          <ha-card>
            ${this._config.title ? `<h1 class="card-header">${esc(this._config.title)}</h1>` : ""}
            <div class="om-wrap"><div class="om-map"></div></div>
            <div class="om-att">${esc(this._config.attribution || "")}</div>
          </ha-card>
        `;
      }
    }

    _showError(message) {
      const container = this.querySelector(".om-map");
      if (container) {
        container.innerHTML = `<div class="om-error">${esc(message)}</div>`;
      }
    }

    _showLoading(message = "Loading map...") {
      const container = this.querySelector(".om-map");
      if (container) {
        container.innerHTML = `<div class="om-loading">${esc(message)}</div>`;
      }
    }

    _getDefaultCenter() {
      const lat = this._hass?.config?.latitude;
      const lon = this._hass?.config?.longitude;
      if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon)) {
        return [lat, lon];
      }
      return [48.8, 9.2];
    }

    _initMap() {
      if (!this._L) return;
      const container = this.querySelector(".om-map");
      if (!container) return;

      // Disconnect existing observers before re-initializing map
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._visibilityObserver) {
        this._visibilityObserver.disconnect();
        this._visibilityObserver = null;
      }

      if (this._map) {
        this._map.off("resize");
        if (this._tileLayer) {
          this._map.removeLayer(this._tileLayer);
          this._tileLayer = null;
        }
        this._map.remove();
        this._map = null;
      }

      const cfg = this._config;
      const center = cfg.center ?? this._getDefaultCenter();

      this._map = this._L.map(container, {
        center: center,
        zoom: cfg.default_zoom || 7,
        zoomControl: true,
        attributionControl: true,
      });

      this._addTileLayer();
      this._markerGroup = this._L.layerGroup().addTo(this._map);

      this._map.on("resize", () => this._map && this._map.invalidateSize());

      this._resizeObserver = new ResizeObserver(() => {
        if (this._map) this._map.invalidateSize();
      });
      this._resizeObserver.observe(container);

      this._visibilityObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && this._map) {
          this._map.invalidateSize();
        }
      });
      this._visibilityObserver.observe(container);

      setTimeout(() => this._map && this._map.invalidateSize(), 200);
      this._renderMarkers();
    }

    _addTileLayer() {
      if (!this._L || !this._map) return;
      if (this._tileLayer) {
        this._map.removeLayer(this._tileLayer);
      }
      const dark = this._isDark();
      this._tileLayer = this._L.tileLayer(
        dark ? "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png" : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution: dark
            ? '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }
      ).addTo(this._map);
    }

    _isDark() {
      const cfg = this._config;
      if (cfg.dark_mode === "dark") return true;
      if (cfg.dark_mode === "light") return false;
      const tc = getComputedStyle(document.documentElement).getPropertyValue("--primary-text-color").trim();
      return tc === "#e1e1e1" || document.body.classList.contains("dark");
    }

    _renderMarkers() {
      if (!this._L || !this._map || !this._hass || !this._markerGroup) return;
      this._markerGroup.clearLayers();
      const L = this._L;
      const cfg = this._config;
      const st = this._hass.states || {};
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
        const name = e._custom_name || e.attributes.friendly_name || e.entity_id;
        const color = (mc.color && mc.color.default) || "red";
        const svg = pinSVG(color);
        const icon = L.divIcon({ html: svg, className: "", iconSize: [24, 36], iconAnchor: [12, 36], popupAnchor: [0, -36] });
        const marker = L.marker([lat, lon], { icon }).addTo(this._markerGroup);
        const content = this._buildPopup(e, mc.popup || {});
        if (content) marker.bindPopup(content, { closeButton: true, className: "om-popup-container", maxWidth: 350 });
      });
    }

    _buildPopup(state, pc) {
      const title = pc.title ? this._resolve(state, pc.title) : state.attributes.friendly_name || state.entity_id;
      const body = pc.body ? this._resolve(state, pc.body) : "";
      const fields = pc.fields || [
        { label: "State", value: "state" },
      ];
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
  }

  customElements.define("openmap-card", OpenmapCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "openmap-card",
    name: "Open Map Card",
    description: "Extensible replacement for the built-in Home Assistant map card",
    preview: false,
    documentationURL: "https://github.com/your-username/openmap",
  });

  return { VERSION };
})();