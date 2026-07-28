# Open Map Card

[![HACS Dashboard](https://img.shields.io/badge/HACS-Dashboard-41BDF5.svg)](https://hacs.xyz)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A drop-in replacement for Home Assistant's built-in map card with a plugin-ready architecture for custom markers, popup templates, and data sources.

## Features

- **Works like the built-in HA map** — same Leaflet rendering, same look and feel, same dark/light mode support
- **Entity rendering** — display Home Assistant entities with `latitude`/`longitude` attributes using `entities`, `geolocation_sources`, and `include_domains` (same config format as the built-in card)
- **Custom popups** — dark/light mode aware, with configurable fields
- **Plugin-ready** — add new marker types, popup templates, or data sources via configuration

## Installation

### HACS (Recommended)

1. Ensure [HACS](https://hacs.xyz) is installed
2. Add this repository as a **custom repository** in HACS:
   - Type: `Dashboard`
   - URL: `https://github.com/your-username/openmap`
3. Click **Install**
4. Add a **Open Map Card** card to any Lovelace dashboard

### Manual

1. Copy `openmap-card.js` to your HA `config/www/` directory
2. Add to your Lovelace resources:
   ```yaml
   resources:
     - url: /local/openmap-card.js
       type: module
   ```
3. Add the card via the Lovelace UI or YAML

## Configuration

### Basic Card

```yaml
type: custom:openmap-card
title: My Map
default_zoom: 7
center:
  - 48.8
  - 9.2
entities:
  - device_tracker.paulus
  - zone.home
  - entity: sensor.temperature
    name: Temperature
```

### With Entity Sources

```yaml
type: custom:openmap-card
title: Family Map
entities:
  - device_tracker.john
  - device_tracker.jane
geolocation_sources:
  - gpslogger
include_domains:
  - zone
```

### Custom Popup

```yaml
type: custom:openmap-card
marker:
  color:
    default: blue
  popup:
    title: friendly_name
    body: "Last seen: {last_seen}"
    fields:
      - label: State
        value: state
      - label: Battery
        value: battery_level
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `title` | `""` | Card title |
| `entities` | `[]` | List of entity IDs or `{entity, name}` objects |
| `geolocation_sources` | `[]` | Geo-location source names to include |
| `include_domains` | `[]` | Domain names whose entities to include |
| `default_zoom` | `7` | Initial zoom level |
| `center` | `[48.8, 9.2]` | Initial map center `[lat, lon]` |
| `dark_mode` | `"auto"` | `"auto"`, `"light"`, or `"dark"` |
| `attribution` | `""` | Custom attribution text |
| `marker.color.default` | `"red"` | Default marker color |
| `marker.popup.title` | `friendly_name` | Popup title template |
| `marker.popup.body` | `""` | Popup body template |
| `marker.popup.fields` | `[{label: "State", value: "state"}]` | Popup field list |

## Marker Colors

Available colors: `red`, `orange`, `green`, `blue`, `purple`

## License

MIT
