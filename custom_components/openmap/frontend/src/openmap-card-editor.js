import { LitElement, html, css, nothing } from "lit";

const CARD_VERSION = "0.2.4";

class OpenmapCardEditor extends LitElement {
  static properties = {
    hass: { type: Object },
    config: { type: Object },
    _newEntity: { state: true },
  };

  constructor() {
    super();
    this.config = {};
    this._newEntity = "";
  }

  setConfig(config) {
    this.config = { ...config };
  }

  static styles = css`
    :host {
      display: block;
      font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
    }
    .section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--divider-color, #e0e0e0); }
    .section-title { font-size: 13px; font-weight: 600; margin: 0 0 4px 0; }
    .section-hint { font-size: 11px; opacity: 0.7; margin: 0 0 10px 0; line-height: 1.4; }
    .field-row { display: flex; gap: 12px; margin-bottom: 8px; }
    .field-row > * { flex: 1; }
    .color-options { display: flex; gap: 8px; flex-wrap: wrap; }
    .color-option {
      width: 32px; height: 32px; border-radius: 50%;
      border: 2px solid transparent; cursor: pointer; transition: transform 0.15s;
    }
    .color-option.selected { transform: scale(1.15); border-color: var(--primary-color); }
    .color-option:hover { transform: scale(1.1); }
  `;

  _emit() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this.config },
      bubbles: true,
      composed: true,
    }));
  }

  _handleSimpleChange(e) {
    const values = e.detail?.value;
    if (!values || typeof values !== "object") return;
    this.config = { ...this.config, ...values };
    this._emit();
  }

  _colorChanged(color) {
    this.config = {
      ...this.config,
      marker: { ...this.config.marker, color: { ...this.config.marker?.color, default: color } },
    };
    this._emit();
  }

  _setIncludeDomains(e) {
    const raw = e.target.value;
    const value = raw.split(",").map(s => s.trim()).filter(Boolean);
    this.config = { ...this.config, include_domains: value };
    this._emit();
  }

  _setMarkerValue(e) {
    const key = e.target.name;
    let value = e.target.value;
    if (key === "size") value = Number(value) || 48;
    this.config = {
      ...this.config,
      marker: { ...this.config.marker, [key]: value },
    };
    this._emit();
  }

  render() {
    if (!this.hass) return nothing;
    const cfg = this.config;
    const colors = ["red", "orange", "green", "blue", "purple"];
    const themeMode = cfg.theme_mode || cfg.dark_mode || "auto";

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{
          title: cfg.title || "",
          default_zoom: cfg.default_zoom || 14,
          center_lat: cfg.center_lat !== undefined ? cfg.center_lat : "",
          center_lon: cfg.center_lon !== undefined ? cfg.center_lon : "",
          theme_mode: themeMode,
          cluster: cfg.cluster !== false,
          aspect_ratio: cfg.aspect_ratio || "",
          attribution: cfg.attribution || "",
        }}
        .schema=${[
          { name: "title", label: "Title", selector: { text: {} } },
          { name: "default_zoom", label: "Default Zoom", selector: { number: { min: 1, max: 20, step: 1 } } },
          { name: "center_lat", label: "Map Center Latitude", selector: { number: { min: -90, max: 90, step: 0.000001 } } },
          { name: "center_lon", label: "Map Center Longitude", selector: { number: { min: -180, max: 180, step: 0.000001 } } },
          { name: "theme_mode", label: "Theme Mode", selector: { select: { options: ["auto", "light", "dark"] } } },
          { name: "cluster", label: "Cluster Markers", selector: { boolean: {} } },
          { name: "aspect_ratio", label: "Aspect Ratio (e.g. 1:1)", selector: { text: {} } },
          { name: "attribution", label: "Custom Attribution", selector: { text: {} } },
        ]}
        .computeLabel=${(s) => s.label}
        @value-changed=${this._handleSimpleChange}
      ></ha-form>

      <div class="section">
        <p class="section-title">Explicit Entities</p>
        <p class="section-hint">
          Select device trackers, persons, zones, or sensors with latitude/longitude attributes.
        </p>
        <ha-entity-picker
          .hass=${this.hass}
          .value=${(cfg.entities || []).join(",")}
          .includeDomains=${["device_tracker", "person", "zone", "sensor", "geo_location"]}
          allow-custom-entity
          @value-changed=${(e) => {
            const raw = e.detail?.value || "";
            this.config = { ...this.config, entities: raw.split(",").map(s => s.trim()).filter(Boolean) };
            this._emit();
          }}
        ></ha-entity-picker>
      </div>

      <div class="section">
        <p class="section-title">Geolocation Sources</p>
        <p class="section-hint">
          Include all geo_location entities matching these sources (e.g. gpslogger, icloud).
        </p>
        <ha-entity-picker
          .hass=${this.hass}
          .value=${(cfg.geo_location_sources || cfg.geolocation_sources || []).join(",")}
          .includeDomains=${["geo_location"]}
          @value-changed=${(e) => {
            const raw = e.detail?.value || "";
            this.config = { ...this.config, geo_location_sources: raw.split(",").map(s => s.trim()).filter(Boolean) };
            this._emit();
          }}
        ></ha-entity-picker>
      </div>

      <div class="section">
        <p class="section-title">Include Domains</p>
        <p class="section-hint">
          Comma-separated domains whose entities with lat/lon should appear (e.g. zone,device_tracker).
        </p>
        <input
          type="text"
          .value=${(cfg.include_domains || []).join(",")}
          @input=${this._setIncludeDomains}
          placeholder="zone,device_tracker,person"
        />
      </div>

      <div class="section">
        <p class="section-title">Marker Appearance</p>
        <div class="field-row">
          <input
            type="number"
            name="size"
            min="24"
            max="96"
            step="2"
            .value=${cfg.marker?.size || 48}
            @input=${this._setMarkerValue}
            title="Marker size (px)"
            placeholder="Marker size (px)"
          />
          <select
            name="label_mode"
            @change=${this._setMarkerValue}
            title="Marker label mode"
          >
            <option value="initials" ${(cfg.marker?.label_mode || "initials") === "initials" ? "selected" : ""}>Initials</option>
            <option value="name" ${cfg.marker?.label_mode === "name" ? "selected" : ""}>Name</option>
            <option value="state" ${cfg.marker?.label_mode === "state" ? "selected" : ""}>State</option>
            <option value="icon" ${cfg.marker?.label_mode === "icon" ? "selected" : ""}>Icon</option>
          </select>
        </div>
        <p class="section-hint">Default marker color:</p>
        <div class="color-options">
          ${colors.map(color => html`
            <div
              class="color-option ${(cfg.marker?.color?.default || "default") === color ? "selected" : ""}"
              style="background:${color}"
              @click=${() => this._colorChanged(color)}
              title=${color}
            ></div>
          `)}
        </div>
      </div>

      <div class="section">
        <p class="section-title">Popup Configuration</p>
        <ha-form
          .hass=${this.hass}
          .data=${{
            popup_title: cfg.marker?.popup?.title || "friendly_name",
            popup_body: cfg.marker?.popup?.body || "",
          }}
          .schema=${[
            { name: "popup_title", label: "Popup Title Template", selector: { text: {} } },
            { name: "popup_body", label: "Popup Body Template", selector: { text: { multiline: true } } },
          ]}
          .computeLabel=${(s) => s.label}
          @value-changed=${(e) => {
            const v = e.detail?.value;
            if (!v) return;
            this.config = {
              ...this.config,
              marker: {
                ...this.config.marker,
                popup: { ...this.config.marker?.popup, title: v.popup_title, body: v.popup_body },
              },
            };
            this._emit();
          }}
        ></ha-form>
      </div>

      <div class="section">
        <p class="section-hint">Open Map card editor v${CARD_VERSION}</p>
      </div>
    `;
  }
}

if (!customElements.get("openmap-card-editor")) {
  customElements.define("openmap-card-editor", OpenmapCardEditor);
} else {
  // Already defined (possibly by a stale old resource); leave it alone.
}

export { OpenmapCardEditor };
