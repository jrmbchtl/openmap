import { LitElement, html, css, nothing } from "lit";

const CARD_VERSION = "0.2.8";

const DOMAIN_OPTIONS = [
  "zone",
  "device_tracker",
  "person",
  "sensor",
  "geo_location",
  "camera",
];

const LABEL_MODE_OPTIONS = ["initials", "name", "state", "icon"];

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
    const next = { ...this.config, ...values };
    // Never persist empty center fields (they would become [0, 0]).
    if (next.center_lat === "" || next.center_lat == null) delete next.center_lat;
    if (next.center_lon === "" || next.center_lon == null) delete next.center_lon;
    this.config = next;
    this._emit();
  }

  _handleMarkerForm(e) {
    const v = e.detail?.value;
    if (!v) return;
    const marker = { ...this.config.marker };
    if (v.marker_size !== undefined) marker.size = Number(v.marker_size) || 48;
    if (v.marker_label_mode !== undefined) marker.label_mode = v.marker_label_mode;
    marker.color = { ...(marker.color || {}) };
    if (v.marker_color_custom !== undefined) {
      if (v.marker_color_custom) {
        const existing = marker.color.default;
        marker.color.default = existing && existing !== "default" ? existing : "#F44336";
      } else {
        marker.color.default = "default";
      }
    }
    if (v.marker_color !== undefined && v.marker_color_custom) {
      marker.color.default = v.marker_color;
    }
    this.config = { ...this.config, marker };
    this._emit();
  }

  render() {
    if (!this.hass) return nothing;
    const cfg = this.config;
    const themeMode = cfg.theme_mode || cfg.dark_mode || "auto";
    const markerColorDefault = cfg.marker?.color?.default;
    const markerColorCustom = markerColorDefault !== undefined && markerColorDefault !== "default";
    const markerSchema = [
      { name: "marker_size", label: "Marker Size (px)", selector: { number: { mode: "box", min: 24, max: 96, step: 2 } } },
      { name: "marker_label_mode", label: "Marker Label", selector: { select: { options: LABEL_MODE_OPTIONS } } },
      { name: "marker_color_custom", label: "Custom Marker Color", selector: { boolean: {} } },
    ];
    if (markerColorCustom) {
      markerSchema.push({ name: "marker_color", label: "Marker Color", selector: { color: {} } });
    }

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{
          title: cfg.title || "",
          default_zoom: cfg.default_zoom || 14,
          center_lat: cfg.center_lat !== undefined ? cfg.center_lat : this.hass.config?.latitude ?? "",
          center_lon: cfg.center_lon !== undefined ? cfg.center_lon : this.hass.config?.longitude ?? "",
          theme_mode: themeMode,
          cluster: cfg.cluster !== false,
          include_domains: cfg.include_domains || [],
          attribution: cfg.attribution || "",
        }}
        .schema=${[
          { name: "title", label: "Title", selector: { text: {} } },
          { name: "default_zoom", label: "Default Zoom", selector: { number: { mode: "box", min: 1, max: 20, step: 1 } } },
          { name: "center_lat", label: "Map Center Latitude", selector: { number: { mode: "box", min: -90, max: 90, step: 0.000001 } } },
          { name: "center_lon", label: "Map Center Longitude", selector: { number: { mode: "box", min: -180, max: 180, step: 0.000001 } } },
          { name: "theme_mode", label: "Theme Mode", selector: { select: { options: ["auto", "light", "dark"] } } },
          { name: "cluster", label: "Cluster Markers", selector: { boolean: {} } },
          {
            name: "include_domains",
            label: "Include Domains",
            selector: { select: { multiple: true, custom_value: true, options: DOMAIN_OPTIONS } },
          },
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
        <p class="section-title">Marker Appearance</p>
        <p class="section-hint">
          Size, label, and color of the circular markers. Disable the custom color to follow the theme accent.
        </p>
        <ha-form
          .hass=${this.hass}
          .data=${{
            marker_size: cfg.marker?.size || 48,
            marker_label_mode: cfg.marker?.label_mode || "initials",
            marker_color_custom: markerColorCustom,
            marker_color: markerColorCustom ? markerColorDefault : "#F44336",
          }}
          .schema=${markerSchema}
          .computeLabel=${(s) => s.label}
          @value-changed=${this._handleMarkerForm}
        ></ha-form>
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
