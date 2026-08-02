import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";

/**
 * OpenMap Card Editor - v0.2.1
 * Visual configuration editor for the Open Map custom card
 */

class OpenmapCardEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
    };
  }

  static get styles() {
    return css`
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

  setConfig(config) {
    this.config = { ...config };
  }

  _valueChanged(ev) {
    const target = ev.target;
    const value = target.type === "checkbox" ? target.checked : target.value;
    const key = target.configKey;
    if (!key) return;

    const newConfig = { ...this.config, [key]: value };
    this.config = newConfig;
    this._fireConfigChange();
  }

  _entityChanged(ev) {
    const value = ev.detail.value;
    const key = ev.target.configKey;
    if (!key) return;

    const newConfig = { ...this.config };
    if (key === "entities") {
      newConfig[key] = value;
    }
    this.config = newConfig;
    this._fireConfigChange();
  }

  _multiEntityChanged(ev) {
    const value = ev.detail.value;
    const key = ev.target.configKey;
    if (!key) return;

    const newConfig = { ...this.config };
    newConfig[key] = value;
    this.config = newConfig;
    this._fireConfigChange();
  }

  _colorChanged(color) {
    const newConfig = {
      ...this.config,
      marker: { ...this.config.marker, color: { ...this.config.marker?.color, default: color } }
    };
    this.config = newConfig;
    this._fireConfigChange();
  }

  _fireConfigChange() {
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this.config }, bubbles: true, composed: true }));
  }

  _getEntities() {
    if (!this.hass) return [];
    return Object.keys(this.hass.states).filter(eid => eid.startsWith("device_tracker.") || eid.startsWith("person.") || eid.startsWith("zone.") || eid.startsWith("geo_location."));
  }

  _getGeoSources() {
    if (!this.hass) return [];
    const sources = new Set();
    Object.values(this.hass.states).forEach(s => {
      if (s.entity_id.startsWith("geo_location.") && s.attributes?.source) {
        sources.add(s.attributes.source);
      }
    });
    return Array.from(sources).sort();
  }

  render() {
    if (!this.hass) return html`<div>Loading...</div>`;

    const entities = this._getEntities();
    const geoSources = this._getGeoSources();
    const colors = ["red", "orange", "green", "blue", "purple"];

    return html`
      <div class="editor-section">
        <h3>General</h3>
        <div class="field">
          <label class="field-label">Title</label>
          <input type="text" .value=${this.config.title || ""} configKey="title" @input=${this._valueChanged} placeholder="Open Map">
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Default Zoom</label>
            <input type="number" min="1" max="19" step="1" .value=${this.config.default_zoom || 7} configKey="default_zoom" @input=${this._valueChanged}>
          </div>
          <div class="field">
            <label class="field-label">Dark Mode</label>
            <select .value=${this.config.dark_mode || "auto"} configKey="dark_mode" @change=${this._valueChanged}>
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
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
            <input type="number" step="0.000001" min="-90" max="90" .value=${this.config.center_lat !== undefined ? this.config.center_lat : ""} configKey="center_lat" @input=${this._valueChanged} placeholder="e.g. 48.815">
          </div>
          <div class="field">
            <label class="field-label">Longitude</label>
            <input type="number" step="0.000001" min="-180" max="180" .value=${this.config.center_lon !== undefined ? this.config.center_lon : ""} configKey="center_lon" @input=${this._valueChanged} placeholder="e.g. 9.2">
          </div>
        </div>
      </div>

      <div class="editor-section">
        <h3>Entities</h3>
        <div class="field">
          <label class="field-label">Explicit Entities</label>
          <ha-entity-picker
            .hass=${this.hass}
            .value=${this.config.entities || []}
            .configValue=${this.config.entities || []}
            allow-custom-entity
            multiple
            configKey="entities"
            @value-changed=${this._multiEntityChanged}
            include-domains="device_tracker,person,zone,sensor"
          ></ha-entity-picker>
          <div class="helper-text">Select device trackers, persons, zones, or sensors with latitude/longitude attributes</div>
        </div>

        <div class="field">
          <label class="field-label">Geolocation Sources</label>
          <ha-select
            .value=${this.config.geolocation_sources || []}
            .items=${geoSources}
            multiple
            configKey="geolocation_sources"
            @value-changed=${this._valueChanged}
            placeholder="Select sources (e.g. gpslogger, icloud)"
          ></ha-select>
          <div class="helper-text">Include all geo_location entities matching these sources</div>
        </div>

        <div class="field">
          <label class="field-label">Include Domains</label>
          <input
            type="text"
            .value=${(this.config.include_domains || []).join(",")}
            configKey="include_domains"
            @input=${ev => {
              const value = ev.target.value.split(",").map(s => s.trim()).filter(Boolean);
              const newConfig = { ...this.config, include_domains: value };
              this.config = newConfig;
              this._fireConfigChange();
            }}
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
            ${colors.map(color => html`
              <div
                class="color-option ${(this.config.marker?.color?.default || "red") === color ? "selected" : ""}"
                style="background: ${color}"
                @click=${() => this._colorChanged(color)}
                title=${color}
              ></div>
            `)}
          </div>
        </div>
      </div>

      <div class="editor-section">
        <h3>Popup Configuration</h3>
        <div class="field">
          <label class="field-label">Popup Title Template</label>
          <input type="text" .value=${this.config.marker?.popup?.title || "friendly_name"} configKey="marker_popup_title" @input=${ev => {
            const newConfig = { ...this.config, marker: { ...this.config.marker, popup: { ...this.config.marker?.popup, title: ev.target.value } } };
            this.config = newConfig;
            this._fireConfigChange();
          }} placeholder="friendly_name or {attribute}">
          <div class="helper-text">Use {attribute} syntax to insert entity attributes (e.g. {friendly_name}, {last_seen})</div>
        </div>
        <div class="field">
          <label class="field-label">Popup Body Template</label>
          <input type="text" .value=${this.config.marker?.popup?.body || ""} configKey="marker_popup_body" @input=${ev => {
            const newConfig = { ...this.config, marker: { ...this.config.marker, popup: { ...this.config.marker?.popup, body: ev.target.value } } };
            this.config = newConfig;
            this._fireConfigChange();
          }} placeholder="Last seen: {last_seen}">
        </div>
        <div class="field">
          <label class="field-label">Attribution Text</label>
          <input type="text" .value=${this.config.attribution || ""} configKey="attribution" @input=${this._valueChanged} placeholder="Custom attribution">
        </div>
      </div>
    `;
  }
}

customElements.define("openmap-card-editor", OpenmapCardEditor);