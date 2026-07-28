# Open Map

[![HACS Integration](https://img.shields.io/badge/HACS-Integration-41BDF5.svg)](https://hacs.xyz)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A drop-in replacement for Home Assistant's built-in map card with a plugin-ready architecture. Registers a sidebar panel and works as a Lovelace card.

## Features

- **Sidebar panel** — a full-screen "Open Map" entry in your sidebar
- **Lovelace card** — works as `type: custom:openmap-card` on any dashboard
- **Entity rendering** — display entities with `latitude`/`longitude` using `entities`, `geolocation_sources`, and `include_domains`
- **Custom popups** — dark/light mode aware with configurable fields
- **Dark/light mode** — auto-detects HA theme
- **Plugin-ready** — extensible marker and popup configuration

## Installation

### HACS

1. Ensure [HACS](https://hacs.xyz) is installed
2. Add this repository as a **custom repository** in HACS:
   - Type: **Integration**
   - URL: `https://github.com/your-username/openmap`
3. Click **Install**
4. **Restart Home Assistant**
5. The "Open Map" panel appears in your sidebar

### Manual

1. Copy `custom_components/openmap/` to your HA `config/custom_components/` directory
2. **Restart Home Assistant**

## Usage

### As a sidebar panel

After installation, click **Open Map** in the sidebar — the map opens full-screen with all entities that have `latitude`/`longitude` attributes.

### As a Lovelace card

Add to any dashboard:

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

### With entity sources

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

### Custom popup

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

`red`, `orange`, `green`, `blue`, `purple`

## License

MIT
