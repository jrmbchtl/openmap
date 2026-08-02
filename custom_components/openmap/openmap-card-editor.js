/**
 * OpenMap Card Editor - v0.2.1
 * Visual configuration editor for the Open Map custom card
 * Vanilla Web Component (no external dependencies)
 */

class OpenmapCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {};
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  _fireConfigChange() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true
    }));
  }

  _valueChanged(ev) {
    const target = ev.target;
    const value = target.type === "checkbox" ? target.checked : target.value;
    const key = target.configKey;
    if (!key) return;

    const newConfig = { ...this._config, [key]: value };
    this._config = newConfig;
    this._fireConfigChange();
  }

  _entityChanged(ev) {
    const value = ev.detail.value;
    const key = ev.target.configKey;
    if (!key) return;

    const newConfig = { ...this._config };
    if (key === "entities") {
      newConfig[key] = value;
    }
    this._config = newConfig;
    this._fireConfigChange();
  }

  _multiEntityChanged(ev) {
    const value = ev.detail.value;
    const key = ev.target.configKey;
    if (!key) return;

    const newConfig = { ...this._config };
    newConfig[key] = value;
    this._config = newConfig;
    this._fireConfigChange();
  }

  _colorChanged(color) {
    const newConfig = {
      ...this._config,
      marker: { ...this._config.marker, color: { ...this._config.marker?.color, default: color } }
    };
    this._config = newConfig;
    this._fireConfigChange();
  }

  _getEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states).filter(eid =>
      eid.startsWith("device_tracker.") ||
      eid.startsWith("person.") ||
      eid.startsWith("zone.") ||
      eid.startsWith("geo_location.")
    );
  }

  _getGeoSources() {
    if (!this._hass) return [];
    const sources = new Set();
    Object.values(this._hass.states).forEach(s => {
      if (s.entity_id.startsWith("geo_location.") && s.attributes?.source) {
        sources.add(s.attributes.source);
      }
    });
    return Array.from(sources).sort();
  }

  _getStyle() {
    return `
      :host { display: block; }
      .editor-section { margin-bottom: 16px; }
      .editor-section h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--primary-text-color); }
      .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
      .field-label { font-size: 13px; font-weight: 500; color: var(--secondary-text-color); }
      .field-row { display: flex; gap: 12px; }
      .field-row > * { flex: 1; }
      select, input, ha-entity-picker, ha-select { width: 100%; }
      .color-options { display: flex; gap: 8px; flex-wrap: wrap; }
      .color-option { width: 32px; height: 32px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: transform 0.15s; }
      .color-option.selected { transform: scale(1.15); border-color: var(--primary-color); }
      .color-option:hover { transform: scale(1.1); }
      .checkbox-row { display: flex; align-items: center; gap: 8px; }
      .helper-text { font-size: 12px; color: var(--secondary-text-color); margin-top: 4px; }
      ha-textarea { width: 100%; }
    `;
  }

  _renderTemplate() {
    if (!this._hass) return `<div>Loading...</div>`;

    const entities = this._getEntities();
    const geoSources = this._getGeoSources();
    const colors = ["red", "orange", "green", "blue", "purple"];
    const cfg = this._config;

    const entityOptions = entities.map(e => `<option value="${e}">${e}</option>`).join("");
    const geoSourceOptions = geoSources.map(s => `<option value="${s}">${s}</option>`).join("");

    return `
      <style>${this._getStyle()}</style>
      <div class="editor-section">
        <h3>General</h3>
        <div class="field">
          <label class="field-label">Title</label>
          <input type="text" value="${cfg.title || ""}" configKey="title" placeholder="Open Map">
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Default Zoom</label>
            <input type="number" min="1" max="19" step="1" value="${cfg.default_zoom || 7}" configKey="default_zoom">
          </div>
          <div class="field">
            <label class="field-label">Dark Mode</label>
            <select configKey="dark_mode">
              <option value="auto" ${cfg.dark_mode === "auto" ? "selected" : ""}>Auto</option>
              <option value="light" ${cfg.dark_mode === "light" ? "selected" : ""}>Light</option>
              <option value="dark" ${cfg.dark_mode === "dark" ? "selected" : ""}>Dark</option>
            </select>
          </div>
        </div>
      </div>

      <div class="editor-section">
        <h3>Map Center</h3>
        <div class="helper-text">Leave empty to use Home Assistant home zone coordinates</div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Latitude</label>
            <input type="number" step="0.000001" min="-90" max="90" value="${cfg.center_lat !== undefined ? cfg.center_lat : ""}" configKey="center_lat" placeholder="e.g. 48.815">
          </div>
          <div class="field">
            <label class="field-label">Longitude</label>
            <input type="number" step="0.000001" min="-180" max="180" value="${cfg.center_lon !== undefined ? cfg.center_lon : ""}" configKey="center_lon" placeholder="e.g. 9.2">
          </div>
        </div>
      </div>

      <div class="editor-section">
        <h3>Entities</h3>
        <div class="field">
          <label class="field-label">Explicit Entities</label>
          <ha-entity-picker
            .hass="${this._hass}"
            .value="${(cfg.entities || []).join(",")}"
            .configValue="${cfg.entities || []}"
            allow-custom-entity
            multiple
            configKey="entities"
            include-domains="device_tracker,person,zone,sensor"
          ></ha-entity-picker>
          <div class="helper-text">Select device trackers, persons, zones, or sensors with latitude/longitude attributes</div>
        </div>

        <div class="field">
          <label class="field-label">Geolocation Sources</label>
          <ha-select
            .value="${cfg.geolocation_sources || []}"
            .items="${geoSources}"
            multiple
            configKey="geolocation_sources"
            placeholder="Select sources (e.g. gpslogger, icloud)"
          ></ha-select>
          <div class="helper-text">Include all geo_location entities matching these sources</div>
        </div>

        <div class="field">
          <label class="field-label">Include Domains</label>
          <input
            type="text"
            value="${(cfg.include_domains || []).join(",")}"
            configKey="include_domains"
            placeholder="zone,device_tracker,person"
          />
          <div class="helper-text">Comma-separated list of domains to include all entities with lat/lon</div>
        </div>
      </div>

      <div class="editor-section">
        <h3>Marker Appearance</h3>
        <div class="field">
          <label class="field-label">Default Marker Color</label>
          <div class="color-options">
            ${colors.map(color => `
              <div
                class="color-option ${(cfg.marker?.color?.default || "red") === color ? "selected" : ""}"
                style="background: ${color}"
                data-color="${color}"
                title="${color}"
              ></div>
            `).join("")}
          </div>
        </div>
      </div>

      <div class="editor-section">
        <h3>Popup Configuration</h3>
        <div class="field">
          <label class="field-label">Popup Title Template</label>
          <input type="text" value="${cfg.marker?.popup?.title || "friendly_name"}" configKey="marker_popup_title" placeholder="friendly_name or {attribute}">
          <div class="helper-text">Use {attribute} syntax to insert entity attributes (e.g. {friendly_name}, {last_seen})</div>
        </div>
        <div class="field">
          <label class="field-label">Popup Body Template</label>
          <input type="text" value="${cfg.marker?.popup?.body || ""}" configKey="marker_popup_body" placeholder="Last seen: {last_seen}">
        </div>
        <div class="field">
          <label class="field-label">Attribution Text</label>
          <input type="text" value="${cfg.attribution || ""}" configKey="attribution" placeholder="Custom attribution">
        </div>
      </div>
    `;
  }

  _render() {
    this.shadowRoot.innerHTML = this._renderTemplate();
    this._attachEventListeners();
  }

  _attachEventListeners() {
    // Input/Select change handlers
    this.shadowRoot.querySelectorAll("input, select").forEach(el => {
      el.addEventListener("change", (ev) => this._valueChanged(ev));
      el.addEventListener("input", (ev) => this._valueChanged(ev));
    });

    // Entity picker
    this.shadowRoot.querySelectorAll("ha-entity-picker").forEach(el => {
      el.addEventListener("value-changed", (ev) => this._multiEntityChanged(ev));
    });

    // HA Select
    this.shadowRoot.querySelectorAll("ha-select").forEach(el => {
      el.addEventListener("value-changed", (ev) => this._valueChanged(ev));
    });

    // Color options
    this.shadowRoot.querySelectorAll(".color-option").forEach(el => {
      el.addEventListener("click", (ev) => {
        const color = ev.currentTarget.dataset.color;
        this._colorChanged(color);
      });
    });
  }
}

customElements.define("openmap-card-editor", OpenmapCardEditor);