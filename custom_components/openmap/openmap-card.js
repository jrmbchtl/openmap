const OpenMapCard = (() => {
  const VERSION = "1.0.0";
  const LEAFLET_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
  let leafletReady = false;
  const leafletQueue = [];

  function loadLeaflet(callback) {
    if (window.L) { leafletReady = true; callback(window.L); return; }
    leafletQueue.push(callback);
    if (document.querySelector('script[src*="leaflet.js"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_URL + ".css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = LEAFLET_URL + ".js";
    script.onload = () => {
      leafletReady = true;
      const q = leafletQueue.slice();
      leafletQueue.length = 0;
      q.forEach(fn => fn(window.L));
    };
    document.head.appendChild(script);
  }

  function pinSVG(c) {
    const m = { red: "#F44336", orange: "#FF9800", green: "#4CAF50", blue: "#2196F3", purple: "#9C27B0" };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${m[c]||"#F44336"}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>`;
  }

  function esc(s) { if (!s) return ""; const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

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
    `;
    document.head.appendChild(css);
  }

  class OpenmapCard extends HTMLElement {
    constructor() {
      super();
      this._config = {};
      this._map = null;
      this._markerGroup = null;
      this._L = null;
      this._isPanel = false;
      this._ready = false;
      injectStyles();
    }

    setConfig(config) {
      if (!config || typeof config !== "object") throw new Error("Invalid config");
      this._isPanel = false;
      this._config = {
        title: "", entities: [], geolocation_sources: [], include_domains: [],
        default_zoom: 7, center: [48.8, 9.2], dark_mode: "auto",
        attribution: "", marker: {}, ...config
      };
      this._render();
      if (this._map) setTimeout(() => this._map.invalidateSize(), 100);
    }

    set panel(val) {
      this._isPanel = true;
      this._config = {
        title: "", entities: [], geolocation_sources: [], include_domains: [],
        default_zoom: 7, center: [48.8, 9.2], dark_mode: "auto",
        attribution: "", marker: {}, ...(val.config || {})
      };
      this._tryInit();
    }

    set narrow(val) {}
    set route(val) {}

    set hass(hass) {
      this._hass = hass;
      if (this._isPanel) {
        this._tryInit();
      } else if (this._map) {
        this._renderMarkers();
      }
    }

    get hass() { return this._hass; }

    getCardSize() { return 4; }

    _tryInit() {
      if (!this._isPanel || !this._hass || this._ready) return;
      this._ready = true;
      this._render();
      loadLeaflet(L => {
        this._L = L;
        this._initMap();
      });
    }

    connectedCallback() {
      if (this._isPanel) return;
      this._render();
      loadLeaflet(L => {
        this._L = L;
        this._initMap();
      });
    }

    disconnectedCallback() {
      if (this._map) { this._map.remove(); this._map = null; }
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

    _initMap() {
      if (!this._L) return;
      const container = this.querySelector(".om-map");
      if (!container) return;
      if (this._map) { this._map.remove(); this._map = null; }

      const cfg = this._config;
      this._map = this._L.map(container, {
        center: cfg.center || [48.8, 9.2],
        zoom: cfg.default_zoom || 7,
        zoomControl: true,
        attributionControl: true,
      });

      this._addTileLayer();
      this._markerGroup = this._L.layerGroup().addTo(this._map);
      this._map.on("resize", () => this._map && this._map.invalidateSize());
      setTimeout(() => this._map && this._map.invalidateSize(), 200);
      this._renderMarkers();
    }

    _addTileLayer() {
      if (!this._L || !this._map) return;
      const dark = this._isDark();
      this._L.tileLayer(
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
        if (typeof e === "string") { const s = st[e]; if (s && s.attributes.latitude && s.attributes.longitude) entities.push(s); }
        else if (e && e.entity) { const s = st[e.entity]; if (s && s.attributes.latitude && s.attributes.longitude) entities.push({ ...s, _custom_name: e.name }); }
      });

      (cfg.geolocation_sources || []).forEach(src => {
        Object.values(st).forEach(s => {
          if (s.entity_id.startsWith("geo_location.") && s.attributes.source === src && s.attributes.latitude) entities.push(s);
        });
      });

      (cfg.include_domains || []).forEach(d => {
        Object.values(st).forEach(s => {
          if (s.entity_id.startsWith(d + ".") && s.attributes.latitude && s.attributes.longitude) entities.push(s);
        });
      });

      const seen = new Set();
      entities.forEach(e => {
        if (seen.has(e.entity_id)) return;
        seen.add(e.entity_id);
        const lat = parseFloat(e.attributes.latitude);
        const lon = parseFloat(e.attributes.longitude);
        if (isNaN(lat) || isNaN(lon)) return;
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
      if (expr === "state") return obj.state;
      if (typeof expr === "string" && expr.indexOf("{") >= 0)
        return expr.replace(/\{(\w+)\}/g, (_, k) => (obj.attributes && obj.attributes[k] !== undefined) ? String(obj.attributes[k]) : `{${k}}`);
      if (obj.attributes && obj.attributes[expr] !== undefined) return String(obj.attributes[expr]);
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
