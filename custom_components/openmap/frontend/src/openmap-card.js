import { LitElement, html, css, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { normalizeConfig, VERSION } from "./config.js";
import { selectRecords, resolveText } from "./entities.js";
import { preferenceKey, readVisibility, saveVisibility } from "./preferences.js";
import { localize } from "./localize.js";

class OpenmapCard extends LitElement {
  static properties = { _config: { state: true }, _records: { state: true }, _pane: { state: true }, _search: { state: true },
    _selected: { state: true }, _visibility: { state: true }, _status: { state: true }, _error: { state: true }, _keyWarning: { state: true }, _isPanel: { state: true }, _starting: { state: true } };

  constructor() {
    super();
    this._records = []; this._visibility = {}; this._status = {};
    this._search = ""; this._pane = null; this._selected = null; this._generation = 0;
  }
  static async getConfigElement() { await import("./openmap-card-editor.js"); return document.createElement("openmap-card-editor"); }
  static getStubConfig() { return { type: "custom:openmap-card", entities: [], overlay_layers: [] }; }
  setConfig(input) {
    this._config = normalizeConfig(input);
    this._records = [];
    this._selected = null;
    this._resetEngine();
    this._preferenceKey = null;
    this._sync();
  }
  set hass(value) {
    const old = this._hass;
    this._hass = value;
    this._sync();
    if (old?.themes?.darkMode !== value?.themes?.darkMode || old?.language !== value?.language) {
      if (old && this._config?.theme_mode === "auto" && old.themes?.darkMode !== value?.themes?.darkMode) this._resetEngine();
      this.requestUpdate();
    }
  }
  get hass() { return this._hass; }
  set panel(value) { this._isPanel = true; this.classList.add("panel-mode"); this.setConfig(value?.config || {}); }
  set narrow(value) { this._narrow = value; }
  getCardSize() { return 7; }
  getGridOptions() { return { columns: 12, rows: 7, min_columns: 6, min_rows: 5 }; }
  _t(key, values) { return localize(this._hass?.language, key, values); }

  _sync() {
    if (!this._config || !this._hass) return;
    const records = selectRecords(this._config, this._hass);
    if (this._records.length !== records.length || records.some((r, i) => r.id !== this._records[i]?.id || r.state !== this._records[i]?.state)) this._records = records;
    const key = preferenceKey(this._hass.user?.id, this._config);
    if (key !== this._preferenceKey || !Object.keys(this._visibility).length) {
      this._preferenceKey = key;
      this._visibility = readVisibility(this._storage(), key, this._config.overlay_layers);
    }
    this._engine?.update(this._records);
    for (const [preset, visible] of Object.entries(this._visibility)) this._engine?.setTraffic(preset, visible);
    this._ensureEngine();
  }
  _storage() { try { return window.localStorage; } catch { return null; } }
  connectedCallback() {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver(() => { this._engine?.resize(); this._ensureEngine(); });
    this._resizeObserver.observe(this);
    this._intersectionObserver = new IntersectionObserver(entries => {
      this._visible = entries[0]?.isIntersecting;
      if (this._visible) this._ensureEngine();
    });
    this._intersectionObserver.observe(this);
  }
  disconnectedCallback() {
    this._resizeObserver?.disconnect(); this._intersectionObserver?.disconnect();
    this._resetEngine();
    super.disconnectedCallback();
  }
  updated() { this._engine?.resize(); this._ensureEngine(); }
  _hasContent() { const c = this._config; return !!c && !!(c.entities.length || c.include_domains.length || c.geo_location_sources.length || c.overlay_layers.length); }
  _resetEngine() {
    this._generation++;
    this._keyController?.abort();
    this._starting = false;
    this._engine?.dispose(); this._engine = null;
    this._status = {}; this._error = false; this._keyWarning = false;
  }
  async _ensureEngine() {
    const target = this.renderRoot?.querySelector("#map");
    if (this._engine || this._starting || this._error || !this.isConnected || !this._visible || !this._hass || !this._hasContent() || !target?.clientWidth) return;
    this._starting = true;
    const generation = this._generation;
    try {
      const module = await import("./map-engine.js");
      let key = null;
      if (this._config.basemap === "carto") {
        this._keyController = new AbortController();
        try {
          const response = await this._hass.fetchWithAuth("/api/openmap/basemap_key", { cache: "no-store", signal: AbortSignal.any([this._keyController.signal, AbortSignal.timeout(10000)]) });
          if (response.ok) key = (await response.json())?.carto_api_key;
        } catch { /* Fall back explicitly to OSM. */ }
      }
      if (generation !== this._generation || !this.isConnected) return;
      this._keyWarning = this._config.basemap === "carto" && !key;
      this._engine = new module.MapEngine({ target, config: this._config, cartoKey: key,
        dark: this._config.theme_mode === "dark" || (this._config.theme_mode === "auto" && this._hass.themes?.darkMode),
        accent: getComputedStyle(this).getPropertyValue("--primary-color").trim(),
        fetchWithAuth: (url, options) => this._hass.fetchWithAuth(url, options),
        onSelect: ids => { this._selected = ids.length === 1 ? ids[0] : null; this._pane = "entities"; this._search = ""; this._focusInspector(); },
        onStatus: status => { this._status = status; } });
      this._sync();
    } catch { if (generation === this._generation) this._error = true; }
    finally { if (generation === this._generation) this._starting = false; }
  }
  _togglePane(pane) { this._pane = this._pane === pane ? null : pane; this._selected = null; if (this._pane) this._focusInspector(); }
  async _focusInspector() {
    await this.updateComplete;
    const selector = this._selected ? ".detail h3" : this._pane === "setup" ? ".inspector h2" : ".search-label input";
    (this.renderRoot.querySelector(selector) || this.renderRoot.querySelector(".inspector button"))?.focus();
  }
  _closePane() {
    const pane = this._pane;
    this._pane = null; this._selected = null;
    this.renderRoot.querySelector(pane === "setup" ? ".empty .primary" : `[data-pane="${pane}"]`)?.focus();
  }
  async _select(record) {
    this._selected = record.id;
    await this._focusInspector();
    if (record.mapped) this._engine?.focus(record.id, this._fitPadding());
  }
  _fitPadding() {
    const inspector = this.renderRoot.querySelector(".inspector");
    if (!inspector) return [64, 64, 64, 64];
    return this.clientWidth <= 600 ? [48, 48, inspector.clientHeight + 56, 48] : [64, inspector.clientWidth + 36, 64, 64];
  }
  _toggleLayer(preset, checked) {
    this._visibility = { ...this._visibility, [preset]: checked };
    saveVisibility(this._storage(), this._preferenceKey, this._visibility);
    this._engine?.setTraffic(preset, checked);
  }
  _retry() { if (this._error) { this._resetEngine(); this._ensureEngine(); } else this._engine?.retry(); }
  _configure() {
    if (this._isPanel) { window.history.pushState(null, "", "/config/integrations/integration/openmap"); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); }
    else { this._pane = "setup"; this._focusInspector(); }
  }
  _moreInfo(id) { this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true })); }
  _icon(icon) { return html`<ha-icon .icon=${icon} aria-hidden="true"></ha-icon>`; }
  _button(label, icon, action, disabled = false) { return html`<button type="button" title=${label} aria-label=${label} @click=${action} ?disabled=${disabled}>${this._icon(icon)}</button>`; }

  _entityDetail(record) {
    const popup = this._config.marker.popup;
    const date = new Date(record.updated);
    const updated = record.updated && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(this._hass.language || "en", { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
    return html`<div class="detail"><h3 tabindex="-1">${resolveText(record.state, popup.title) || record.name}</h3>
      ${popup.body ? html`<p class="body">${resolveText(record.state, popup.body)}</p>` : nothing}
      <dl><dt>${this._t("state")}</dt><dd>${record.state?.state || this._t("missing")}</dd>
        <dt>${this._t("updated")}</dt><dd>${updated}</dd>
        ${record.accuracy ? html`<dt>${this._t("accuracy")}</dt><dd>${record.accuracy} m</dd>` : nothing}
        ${record.zone && record.radius ? html`<dt>${this._t("zoneRadius")}</dt><dd>${record.radius} m</dd>` : nothing}
        ${record.battery != null ? html`<dt>${this._t("battery")}</dt><dd>${String(record.battery)}%</dd>` : nothing}
        ${popup.fields.map(f => html`<dt>${f.label}</dt><dd>${resolveText(record.state, f.value)}</dd>`)}</dl>
      <div class="detail-actions"><button ?disabled=${!record.mapped || !this._engine} @click=${() => { this._closePane(); this._engine?.focus(record.id); }}>${this._t("show")}</button>
        <button ?disabled=${!record.state} @click=${() => this._moreInfo(record.id)}>${this._t("details")}</button></div></div>`;
  }
  _inspector() {
    if (!this._pane) return nothing;
    const record = this._records.find(r => r.id === this._selected);
    const results = this._records.filter(r => `${r.name} ${r.id}`.toLocaleLowerCase().includes(this._search.toLocaleLowerCase()));
    return html`<section class="inspector" aria-label=${this._t(this._pane === "traffic" ? "traffic" : "entities")} @keydown=${e => { if (e.key === "Escape") { e.stopPropagation(); this._closePane(); } }}>
      <div class="inspector-header">${record ? this._button(this._t("back"), "mdi:arrow-left", () => { this._selected = null; this._focusInspector(); }) : nothing}<h2 tabindex="-1">${this._t(this._pane === "traffic" ? "traffic" : this._pane === "setup" ? "configure" : "entities")}</h2>
        ${this._button(this._t("close"), "mdi:close", () => this._closePane())}</div>
      <div class="inspector-content">${this._pane === "setup" ? html`<p>${this._t("dashboardHelp")}</p>` : this._pane === "traffic" ? html`
        <p class="muted">${this._t("provider")}</p>
        ${this._config.overlay_layers.length ? html`<div class="layer-list">${this._config.overlay_layers.map(l => html`<label class="layer"><span>${l.name}</span><span class="switch-control"><input type="checkbox" role="switch" .checked=${!!this._visibility[l.preset]} @change=${e => this._toggleLayer(l.preset, e.target.checked)}><span class="switch-track" aria-hidden="true"></span></span></label>`)}</div>
          <p class="muted">${this._t("remembered")}</p><p class="muted">${this._t("area")}</p><p class="muted">${this._t("fetched")} ${Object.values(this._status).some(s => s.fetchedAt) ? new Intl.DateTimeFormat(this._hass.language || "en", { timeStyle:"short", dateStyle:"medium" }).format(new Date(Math.max(...Object.values(this._status).map(s => s.fetchedAt || 0)) * 1000)) : this._t("notFetched")}</p><button class="text-action" ?disabled=${!this._engine} @click=${() => this._engine?.focusTraffic(this._fitPadding())}>${this._t("focusTraffic")}</button>` : html`<p>${this._t("noTraffic")}</p>`}
      ` : html`
        ${record ? this._entityDetail(record) : html`<label class="search-label">${this._t("search")}<input type="search" .value=${this._search} @input=${e => { this._search = e.target.value; }}></label>
          <p class="muted count">${this._t("count", { mapped: this._records.filter(r => r.mapped).length, total: this._records.length })}</p>
          ${this._records.total > 500 ? html`<p role="status">${this._t("limit")}</p>` : nothing}
          ${results.length ? html`<ul class="entity-list">${repeat(results, r => r.id, r => html`<li><button class="entity" @click=${() => this._select(r)}>
            ${this._icon(/^mdi:[\w-]+$/.test(r.state?.attributes?.icon || "") ? r.state.attributes.icon : r.zone ? "mdi:map-marker-radius" : "mdi:map-marker")}
            <span><strong>${r.name}</strong><small>${!r.state ? this._t("missing") : !r.available ? this._t("unavailable") : !r.mapped ? this._t("noLocation") : r.state.state}</small></span>
            ${this._icon("mdi:chevron-right")}</button></li>`)}</ul>` : html`<p>${this._t(this._records.length ? "noMatches" : "noEntities")}</p>`}`}
      `}</div></section>`;
  }

  render() {
    if (!this._config) return nothing;
    const content = this._hasContent();
    const baseError = this._status.basemap?.error;
    const trafficError = Object.entries(this._status).some(([id, state]) => id !== "basemap" && this._visibility[id] && state.error);
    const loading = this._starting || Object.values(this._status).some(state => state.loading > 0);
    return html`<ha-card><header class="toolbar">
      ${this._isPanel ? this._button("Menu", "mdi:menu", () => this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }))) : nothing}
      <h1>${this._config.title}</h1><nav aria-label="Map content">
        <button data-pane="entities" aria-expanded=${this._pane === "entities"} @click=${() => this._togglePane("entities")}>${this._icon("mdi:account-multiple-outline")}${this._t("entities")}</button>
        <button data-pane="traffic" aria-expanded=${this._pane === "traffic"} @click=${() => this._togglePane("traffic")}>${this._icon("mdi:layers-outline")}${this._t("traffic")}</button></nav></header>
      ${this._error || baseError || trafficError || this._keyWarning ? html`<div class="notice" role="status"><span>${this._t(this._error ? "mapError" : baseError ? "baseError" : trafficError ? "trafficError" : "noKey")}</span>
        ${this._keyWarning && !this._error && !baseError && !trafficError ? nothing : html`<button @click=${() => this._retry()}>${this._t("retry")}</button>`}</div>` : nothing}
      <div class="workspace">
        <div id="map" role="region" aria-label=${this._config.title} tabindex="0"></div>
        ${content ? html`<div class="map-actions">
          ${this._button(this._t("zoomIn"), "mdi:plus", () => this._engine?.zoom(1), !this._engine)}
          ${this._button(this._t("zoomOut"), "mdi:minus", () => this._engine?.zoom(-1), !this._engine)}
          ${this._button(this._t("fit"), "mdi:fit-to-screen-outline", () => this._engine?.fit(), !this._engine || !this._records.some(r => r.mapped))}</div>` : html`
          <div class="empty"><h2>${this._t("empty")}</h2><p>${this._t("emptyBody")}</p><button class="primary" @click=${() => this._configure()}>${this._t("configure")}</button></div>`}
        ${this._inspector()}
        ${loading ? html`<div class="loading" role="status">${this._t("loading")}</div>` : nothing}
        ${content ? html`<footer class="attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
          ${this._config.basemap === "carto" && !this._keyWarning ? html` · <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">© CARTO</a>` : nothing}
          ${this._config.overlay_layers.some(l => this._visibility[l.preset]) ? html` · <a href="https://logis2.ludwigsburg.de/tbview2/" target="_blank" rel="noopener noreferrer">Stadt Ludwigsburg</a>` : nothing}
          ${this._config.attribution ? html` · ${this._config.attribution}` : nothing}</footer>` : nothing}
      </div></ha-card>`;
  }

  static styles = css`
    :host { display:block; height:100%; min-height:360px; color:var(--primary-text-color,#212121); --om-surface:var(--ha-card-background,var(--card-background-color,#fff)); --om-muted:var(--secondary-text-color,#555); --om-accent:var(--primary-color,#1976d2); font-family:var(--ha-font-family-body,Roboto,sans-serif); container-type:inline-size; }
    * { box-sizing:border-box; } ha-card { display:flex; flex-direction:column; height:100%; min-height:420px; overflow:hidden; }
    :host(.panel-mode) { height:100dvh; padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    :host(.panel-mode) ha-card { border:0; border-radius:0; min-height:0; }
    .toolbar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--om-surface); border-bottom:1px solid var(--divider-color,#ddd); z-index:2; flex-wrap:wrap; }
    h1 { font-size:20px; font-weight:500; margin:0; flex:1; overflow-wrap:anywhere; min-width:100px; } nav { display:flex; gap:4px; } nav button { gap:8px; padding:0 12px; }
    button { display:inline-flex; align-items:center; justify-content:center; min-height:48px; min-width:48px; background:transparent; border:0; border-radius:var(--ha-border-radius-md,8px); color:inherit; font:inherit; cursor:pointer; padding:8px 12px; }
    button:hover:not(:disabled), button[aria-expanded="true"] { background:var(--secondary-background-color,#edf1f4); color:var(--primary-text-color,#212121); }
    button[aria-expanded="true"] ha-icon { color:var(--om-accent); }
    button:disabled { opacity:.45; cursor:default; } button:focus-visible, input:focus-visible, #map:focus-visible, a:focus-visible, .detail h3:focus-visible, .inspector h2:focus-visible { outline:3px solid var(--om-accent); outline-offset:-3px; }
    ha-icon { flex-shrink:0; width:24px; height:24px; --mdc-icon-size:24px; }
    .workspace { position:relative; flex:1; min-height:340px; background:var(--secondary-background-color,#edf1f4); overflow:hidden; } #map { position:absolute; inset:0; } .ol-viewport { touch-action:none; } .ol-unselectable { user-select:none; -webkit-user-select:none; -webkit-tap-highlight-color:transparent; }
    .map-actions { position:absolute; top:12px; left:12px; display:flex; flex-direction:column; padding:4px; border-radius:12px; background:var(--om-surface); box-shadow:0 2px 8px #0003; }
    .empty { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:32px; text-align:center; }
    h2 { font-size:20px; font-weight:500; margin:0; line-height:1.35; overflow-wrap:anywhere; } p { font-size:14px; line-height:1.5; margin:12px 0; max-width:65ch; overflow-wrap:anywhere; }
    .primary { background:var(--om-accent); color:var(--text-primary-color,#fff); margin-top:8px; } .primary:hover:not(:disabled) { background:var(--om-accent); color:var(--text-primary-color,#fff); filter:brightness(.92); }
    .inspector { position:absolute; top:12px; right:12px; bottom:42px; width:min(340px,calc(100% - 96px)); background:var(--om-surface); border-radius:12px; box-shadow:0 4px 16px #0003; display:flex; flex-direction:column; z-index:3; }
    .inspector-header { display:flex; align-items:center; justify-content:space-between; padding:8px 8px 8px 16px; border-bottom:1px solid var(--divider-color,#ddd); gap:8px; } .inspector-header h2 { flex:1; }
    .inspector-content { overflow:auto; padding:16px; overscroll-behavior:contain; scrollbar-color:var(--om-muted) var(--om-surface); scrollbar-width:thin; }
    .muted { color:var(--om-muted); } .count { margin:12px 0 8px; font-variant-numeric:tabular-nums; }
    .search-label { font-size:14px; display:block; } input[type="search"] { display:block; width:100%; min-height:48px; margin-top:8px; padding:10px 12px; font:inherit; color:inherit; background:var(--secondary-background-color,#edf1f4); border:1px solid var(--divider-color,#bbb); border-radius:8px; caret-color:var(--om-accent); }
    .entity-list { list-style:none; padding:0; margin:0 -8px; } .entity { text-align:left; justify-content:flex-start; width:100%; gap:12px; min-height:64px; padding:8px; } .entity span { flex:1; min-width:0; }
    .entity strong { font-size:14px; font-weight:500; display:block; overflow-wrap:anywhere; } .entity small { display:block; font-size:13px; color:var(--om-muted); margin-top:4px; overflow-wrap:anywhere; }
    .layer { display:flex; align-items:center; gap:16px; min-height:56px; cursor:pointer; border-bottom:1px solid var(--divider-color,#ddd); } .layer > span:first-child { flex:1; overflow-wrap:anywhere; }
    .switch-control { position:relative; width:48px; height:48px; flex-shrink:0; } input[type="checkbox"] { position:absolute; inset:0; width:48px; height:48px; margin:0; opacity:0; cursor:pointer; }
    .switch-track { display:block; position:absolute; left:2px; right:2px; top:12px; height:24px; border-radius:12px; background:var(--om-muted); pointer-events:none; }
    .switch-track::after { content:""; display:block; width:18px; height:18px; border-radius:50%; background:var(--om-surface); position:absolute; top:3px; left:3px; }
    input:checked + .switch-track { background:var(--om-accent); } input:checked + .switch-track::after { left:23px; } input:focus-visible + .switch-track { outline:3px solid var(--om-accent); outline-offset:3px; }
    h3 { font-size:18px; line-height:1.4; margin:0 0 16px; overflow-wrap:anywhere; } dl { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.3fr); gap:12px; font-size:14px; } dt { color:var(--om-muted); } dd { margin:0; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; } .body { white-space:pre-wrap; }
    .detail-actions { display:flex; flex-wrap:wrap; gap:4px; margin-top:24px; } .detail-actions button, .text-action { color:var(--om-accent); }
    .notice { background:var(--om-surface); padding:8px 12px; border-bottom:1px solid var(--divider-color,#ddd); display:flex; gap:12px; align-items:center; font-size:14px; }
    .notice span { flex:1; overflow-wrap:anywhere; } .notice button { color:var(--om-accent); flex-shrink:0; } .loading { position:absolute; left:12px; bottom:42px; border-radius:8px; padding:8px 12px; background:var(--om-surface); font-size:14px; pointer-events:none; }
    .attribution { position:absolute; bottom:0; left:0; right:0; background:var(--om-surface); color:var(--om-muted); padding:6px 12px; font-size:11px; line-height:1.4; max-height:36px; overflow:auto; scrollbar-width:thin; } a { color:inherit; text-underline-offset:3px; }
    ::selection { background:var(--om-accent); color:var(--text-primary-color,#fff); }
    @container (max-width:600px) { .toolbar { gap:4px; padding:8px; } h1 { font-size:18px; } nav { width:100%; } nav button { flex:1; } .map-actions { flex-direction:row; } .inspector { top:auto; left:8px; right:8px; bottom:42px; width:auto; max-height:60%; } .inspector-content { padding:12px 16px; } .empty { padding:24px; } .notice { bottom:42px; font-size:13px; } }
    @media (prefers-reduced-motion:no-preference) { .inspector { animation:arrive 160ms cubic-bezier(.16,1,.3,1); } @keyframes arrive { from { transform:translateY(8px); } to { transform:translateY(0); } } }
  `;
}

if (!customElements.get("openmap-card")) customElements.define("openmap-card", OpenmapCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "openmap-card")) window.customCards.push({ type: "openmap-card", name: "Open Map", description: "Entities and Ludwigsburg traffic on one map", preview: true });
console.info(`Open Map ${VERSION}`);
