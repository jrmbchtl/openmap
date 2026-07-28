# Open Map Card

[![HACS Validation](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![hassfest](https://img.shields.io/badge/hassfest-passing-brightgreen)](https://github.com/home-assistant/hassfest)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An extensible, drop-in replacement for Home Assistant's built-in map card. Supports custom overlays, GeoJSON layers, WMS tile layers, custom marker icons (including traffic cones), per-overlay toggle controls, and themed popups.

## Features

- **Works like the built-in HA map** - same Leaflet-based rendering, same look and feel, same dark/light mode support
- **Overlay system** - add multiple data sources on top of the basemap:
  - **GeoJSON** - fetch remote GeoJSON files and render features with custom markers
  - **WMS** - add WMS tile layers (e.g., satellite imagery, thematic maps)
  - **Entities** - render Home Assistant entities with `latitude`/`longitude` attributes
- **Custom marker icons** - built-in types: `cone`, `circle`, `default` (pin), with color mapping based on feature property fields
- **Per-overlay toggle controls** - floating buttons to show/hide each overlay independently
- **Themed popups** - dark/light mode aware, with configurable fields, badges, and date formatting
- **Plugin-ready architecture** - add new marker types, popup templates, or data sources via configuration

## Installation

### HACS (Recommended)

1. Ensure [HACS](https://hacs.xyz) is installed in your Home Assistant instance
2. Add this repository as a **custom repository** in HACS:
   - Type: `Integration`
   - URL: `https://github.com/your-username/openmap`
3. Click **Install** on the "Open Map" integration
4. **Restart Home Assistant**
5. Add a **custom:openmap-card** card to any Lovelace dashboard

### Manual

1. Copy the `custom_components/openmap/` directory to your HA `config/custom_components/` directory
2. Copy the `www/openmap-card.js` file to your HA `config/www/` directory
3. **Restart Home Assistant**
4. Add the card via the Lovelace UI or YAML configuration

### Add to Resources (Frontend)

If you installed manually, add this to your Lovelace resources:

```yaml
resources:
  - url: /local/openmap-card.js
    type: module
```

## Configuration

### Basic Card

```yaml
type: custom:openmap-card
title: Meine Karte
default_zoom: 7
center:
  - 48.8
  - 9.2
```

### With GeoJSON Overlay (Construction Sites)

```yaml
type: custom:openmap-card
title: Baustellen Baden-Wuerttemberg
overlays:
  - name: Baustellen
    type: geojson
    url: "https://api.mobidata-bw.de/datasets/traffic/roadworks/roadworks_geojson.json"
    marker:
      type: cone
      color:
        field: type
        mapping:
          ROAD_CLOSED: red
          CONSTRUCTION: orange
        default: orange
      popup:
        title: street
        body: description
        fields:
          - label: Stra\u00dfe
            value: street
          - label: Zeitraum
            value: "{starttime} \u2192 {endtime}"
            format: date
```

### With WMS Overlay

```yaml
type: custom:openmap-card
overlays:
  - name: Luftbild
    type: wms
    url: "https://example.com/wms"
    layers: orthophoto
    params:
      format: image/png
      transparent: true
    opacity: 0.7
```

### With Entity Overlay

```yaml
type: custom:openmap-card
overlays:
  - name: Personen
    type: entity
    sources:
      - mobile_app
    marker:
      type: circle
      color:
        default: blue
```

## Overlay Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `geojson` | Fetches a GeoJSON file and renders features | `url` or `data` |
| `wms` | Adds a WMS tile layer | `url`, `layers` |
| `entity` | Renders HA entities with lat/lon | `sources` or `entity_ids` |

## Marker Plugins

### Cone

Renders a traffic cone SVG. Colors map to feature properties.

```yaml
marker:
  type: cone
  color:
    field: type
    mapping:
      ROAD_CLOSED: red
      CONSTRUCTION: orange
  size: [24, 28]
```

### Circle

Renders a filled circle.

```yaml
marker:
  type: circle
  color:
    default: blue
  size: [24, 24]
```

### Default (Pin)

Renders a standard map pin.

```yaml
marker:
  type: default
  color:
    default: red
```

## Services

The integration provides the following services (callable from automations/scripts):

### `openmap.register_overlay`

Register a new data overlay programmatically.

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Unique overlay name |
| `data_url` | yes | URL to fetch GeoJSON data |
| `overlay_type` | yes | `geojson`, `wms`, or `entity` |
| `marker_type` | no | `cone`, `circle`, or `default` |
| `filter_bbox` | no | `[min_lon, min_lat, max_lon, max_lat]` |
| `update_interval` | no | Polling interval in seconds (default: 1800) |

### `openmap.unregister_overlay`

Remove a previously registered overlay.

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Name of the overlay to remove |

## Data Attribution

Open Map uses OpenStreetMap tiles (or Stadia Maps dark tiles in dark mode). When displaying third-party data overlays, please include proper attribution in the card configuration.

## License

MIT
