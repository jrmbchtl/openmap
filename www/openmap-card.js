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

  function fmtDate(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (e) { return iso; }
  }

  function centroid(coords, type) {
    if (type === "Point") return [coords[1], coords[0]];
    if (type === "LineString" || type === "MultiPoint") {
      let slat = 0, slon = 0, n = coords.length;
      coords.forEach(c => { slat += c[1]; slon += c[0]; });
      return [slat / n, slon / n];
    }
    if (type === "Polygon" && coords[0]) return centroid(coords[0], "LineString");
    return [48.8, 9.2];
  }

  function coneSVG(c) {
    const m = { red: "#F44336", orange: "#FF9800", green: "#4CAF50", yellow: "#FFC107" };
    const f = m[c] || m.orange;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 28" width="24" height="28"><path d="M12 2L8 8h8zM6 9L4 14h16l-2-5zM3 15l-1 7h20l-1-7zM1 23l-1 3h24l-1-3z" fill="${f}" stroke="#333" stroke-width=".5"/><rect x="10" y="3" width="4" height="3" fill="#fff" opacity=".4"/></svg>`;
  }
  function circSVG(c) {
    const m = { red: "#F44336", orange: "#FF9800", green: "#4CAF50", yellow: "#FFC107", blue: "#2196F3" };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10" fill="${m[c]||"#666"}" stroke="#fff" stroke-width="2"/></svg>`;
  }
  function pinSVG(c) {
    const m = { red: "#F44336", orange: "#FF9800", green: "#4CAF50", yellow: "#FFC107", blue: "#2196F3" };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${m[c]||"#666"}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>`;
  }
  function esc(s) { if (!s) return ""; const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function pickColor(prop, cfg) {
    if (!cfg || !cfg.field) return "orange";
    if (cfg.mapping) return cfg.mapping[prop[cfg.field]] || cfg.default || "orange";
    return cfg.default || "orange";
  }

  const styleId = "openmap-card-styles";
  function injectStyles() {
    if (document.getElementById(styleId)) return;
    const css = document.createElement("style");
    css.id = styleId;
    css.textContent = `
      openmap-card { display:block; height:100%; min-height:400px; }
      .om-wrap { width:100%; height:100%; min-height:400px; border-radius:var(--ha-card-border-radius,12px); overflow:hidden; position:relative; }
      .om-map { width:100%; height:100%; min-height:400px; }
      .om-ctrl { position:absolute; top:12px; right:12px; z-index:1000; display:flex; flex-direction:column; gap:6px; }
      .om-btn { display:flex; align-items:center; gap:8px; background:var(--card-background-color,var(--ha-card-background,#fff)); border:1px solid var(--divider-color,#ddd); border-radius:8px; padding:6px 12px; cursor:pointer; font-size:13px; color:var(--primary-text-color,#333); box-shadow:0 2px 6px rgba(0,0,0,.15); user-select:none; }
      .om-btn:hover { opacity:.85; }
      .om-btn.off { opacity:.5; }
      .om-dot { width:12px; height:12px; border-radius:50%; flex-shrink:0; }
      .om-dot.on { background:#4CAF50; }
      .om-dot.off { background:#ccc; }
      .om-lbl { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px; }
      .om-pop { font-family:var(--primary-font-family,Roboto,sans-serif); color:var(--primary-text-color,#333); min-width:200px; max-width:320px; }
      .om-pop h3 { font-size:15px; font-weight:600; margin:0 0 6px; }
      .om-badge { display:inline-block; padding:2px 10px; border-radius:12px; font-size:11px; font-weight:500; color:#fff; margin-bottom:8px; }
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
      this._groups = {};
      this._visible = {};
      this._L = null;
      attachShadow ? this.attachShadow({ mode: "open" }) : (this._noShadow = true);
      injectStyles();
    }

    setConfig(config) {
      if (!config || typeof config !== "object") throw new Error("Invalid config");
      this._config = {
        title: "", overlays: [], default_zoom: 7,
        center: [48.8, 9.2], dark_mode: "auto",
        attribution: "", ...config
      };
      (this._config.overlays || []).forEach(o => {
        if (!(o.name in this._visible)) this._visible[o.name] = o.visible !== false;
      });
      this._render();
      if (this._map) setTimeout(() => this._map.invalidateSize(), 100);
    }

    set hass(hass) {
      this._hass = hass;
      if (this._map) this._renderOverlays();
    }

    get hass() { return this._hass; }

    getCardSize() { return 4; }

    connectedCallback() {
      if (this._noShadow) return;
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
      const root = this._noShadow ? this : (this.shadowRoot || this.attachShadow({ mode: "open" }));
      if (!root) return;
      const config = this._config;
      root.innerHTML = `
        <ha-card>
          ${config.title ? `<h1 class="card-header">${esc(config.title)}</h1>` : ""}
          <div class="om-wrap">
            <div class="om-map"></div>
            <div class="om-ctrl">
              ${(config.overlays || []).map(o => `
                <div class="om-btn ${this._visible[o.name] !== false ? "" : "off"}" data-overlay="${o.name.replace(/"/g,"&quot;")}">
                  <span class="om-dot ${this._visible[o.name] !== false ? "on" : "off"}"></span>
                  <span class="om-lbl">${esc(o.label || o.name)}</span>
                </div>
              `).join("")}
            </div>
          </div>
          <div class="om-att">${esc(config.attribution || "")}</div>
        </ha-card>
      `;
      root.querySelectorAll(".om-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const name = btn.dataset.overlay;
          const cur = this._visible[name] !== false;
          this._visible[name] = !cur;
          btn.classList.toggle("off", !this._visible[name]);
          btn.querySelector(".om-dot").className = "om-dot " + (this._visible[name] ? "on" : "off");
          this._renderOverlays();
        });
      });
    }

    _initMap() {
      if (!this._L) return;
      const root = this._noShadow ? this : this.shadowRoot;
      if (!root) return;
      const container = root.querySelector(".om-map");
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
      this._map.on("resize", () => this._map && this._map.invalidateSize());
      setTimeout(() => this._map && this._map.invalidateSize(), 200);
      this._renderOverlays();
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

    _renderOverlays() {
      if (!this._L || !this._map) return;
      const L = this._L;
      const cfg = this._config;
      const overlays = cfg.overlays || [];

      const active = new Set(overlays.map(o => o.name));
      Object.keys(this._groups).forEach(k => {
        if (!active.has(k)) { this._map.removeLayer(this._groups[k]); delete this._groups[k]; }
      });

      overlays.forEach(o => {
        if (!this._groups[o.name]) this._groups[o.name] = L.layerGroup().addTo(this._map);
        const g = this._groups[o.name];
        g.clearLayers();

        if (this._visible[o.name] === false) {
          if (this._map.hasLayer(g)) this._map.removeLayer(g);
          return;
        }
        if (!this._map.hasLayer(g)) g.addTo(this._map);

        if (o.type === "geojson") this._renderGeoJSON(o, g, L);
        else if (o.type === "wms") this._renderWMS(o, g, L);
        else if (o.type === "entity") this._renderEntity(o, g, L);
      });
    }

    _renderGeoJSON(o, g, L) {
      const src = (o.data && Array.isArray(o.data)) ? o.data : null;
      if (src) {
        src.forEach(f => this._addMarker(f, o.marker || {}, g, L));
        return;
      }
      if (o.url) {
        fetch(o.url).then(r => r.json()).then(data => {
          const feats = data.features || data || [];
          feats.forEach(f => this._addMarker(f, o.marker || {}, g, L));
        }).catch(e => console.error("OpenMap GeoJSON:", e));
      }
    }

    _renderWMS(o, g, L) {
      const p = o.params || {};
      L.tileLayer.wms(o.url, {
        layers: o.layers || "",
        format: p.format || "image/png",
        transparent: p.transparent !== false,
        version: p.version || "1.3.0",
        attribution: o.attribution || "",
        opacity: o.opacity || 0.7,
      }).addTo(g);
    }

    _renderEntity(o, g, L) {
      if (!this._hass) return;
      const st = this._hass.states || {};
      const ids = o.entity_ids || [];
      const srcs = o.sources || [];
      const doms = o.include_domains || [];
      const ent = [];
      ids.forEach(eid => { const s = st[eid]; if (s && s.attributes.latitude && s.attributes.longitude) ent.push(s); });
      srcs.forEach(sr => { Object.values(st).forEach(s => { if ((s.attributes.source === sr || s.attributes.source === "source." + sr) && s.attributes.latitude) ent.push(s); }); });
      doms.forEach(d => { Object.values(st).forEach(s => { if (s.entity_id.startsWith(d + ".") && s.attributes.latitude) ent.push(s); }); });
      ent.forEach(e => {
        this._addMarker(
          { geometry: { type: "Point", coordinates: [e.attributes.longitude, e.attributes.latitude] },
            properties: { title: e.attributes.friendly_name || e.entity_id, description: e.state, ...e.attributes } },
          o.marker || {}, g, L
        );
      });
    }

    _addMarker(feat, mc, g, L) {
      const geom = feat.geometry;
      if (!geom) return;
      const props = feat.properties || {};
      const c = centroid(geom.coordinates, geom.type);
      const mt = mc.type || "default";
      const color = pickColor(props, mc.color);
      let svg;
      if (mt === "cone") svg = coneSVG(color);
      else if (mt === "circle") svg = circSVG(color);
      else svg = pinSVG(color);
      const sz = mc.size || (mt === "cone" ? [24, 28] : mt === "circle" ? [24, 24] : [24, 36]);
      const an = mc.anchor || (mt === "cone" ? [12, 26] : mt === "circle" ? [12, 12] : [12, 36]);
      const icon = L.divIcon({ html: svg, className: "", iconSize: sz, iconAnchor: an, popupAnchor: mc.popupAnchor || [0, -an[1]] });
      const m = L.marker(c, { icon }).addTo(g);
      const popup = mc.popup || {};
      const content = this._buildPopup(props, popup, color);
      if (content) m.bindPopup(content, { closeButton: true, className: "om-popup-container", maxWidth: 350 });
      return m;
    }

    _buildPopup(props, pc, color) {
      const title = pc.title ? this._resolve(props, pc.title) : props.title || props.street || props.name || props.id || "Standort";
      const body = pc.body ? this._resolve(props, pc.body) : props.description || "";
      const fields = pc.fields || [];
      const cm = { red: "#F44336", orange: "#FF9800", green: "#4CAF50", yellow: "#FFC107" };
      const badgeC = cm[color] || cm.orange;
      const badgeL = color === "red" ? "Vollsperrung" : color === "green" ? "Geplant" : "Teilsperrung";
      let h = '<div class="om-pop">';
      h += `<h3>${esc(title)}</h3><span class="om-badge" style="background:${badgeC}">${badgeL}</span>`;
      fields.forEach(f => {
        let v = this._resolve(props, f.value || f.field || f);
        if (f.format === "date" && v) v = fmtDate(v);
        if (v != null && v !== "") h += `<div class="om-row"><span class="om-l">${esc(f.label || f.name || f)}</span><span class="om-v">${esc(String(v))}</span></div>`;
      });
      if (body) h += `<div class="om-desc">${esc(body)}</div>`;
      h += "</div>";
      return h;
    }

    _resolve(props, expr) {
      if (!expr || !props) return "";
      if (typeof expr === "string" && expr.indexOf("{") >= 0)
        return expr.replace(/\{(\w+)\}/g, (_, k) => props[k] !== undefined ? String(props[k]) : `{${k}}`);
      return props[expr] !== undefined ? String(props[expr]) : "";
    }
  }

  customElements.define("openmap-card", OpenmapCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "openmap-card",
    name: "Open Map Card",
    description: "Extensible map card with overlays, custom markers, and toggles",
    preview: false,
    documentationURL: "https://github.com/your-username/openmap",
  });

  return { VERSION };
})();
