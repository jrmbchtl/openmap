# Open Map

[![HACS Integration](https://img.shields.io/badge/HACS-Integration-41BDF5.svg)](https://hacs.xyz)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Home Assistant entities and official Ludwigsburg traffic on one OpenLayers map.
Works as a dashboard card and a full-screen sidebar panel. Targets **HA 2026.11+**,
desktop and Android Companion App; English and German controls are included.

## Install and choose content

1. Add `https://github.com/jrmbchtl/openmap` as a HACS custom repository of type
   **Integration**, or copy `custom_components/openmap/` into your HA configuration.
2. Restart HA, then add **Open Map** under **Settings → Devices & services**.
3. Explicitly select individual entities, entire domains, geo-location sources,
   traffic layers, or both content groups. Nothing is selected automatically.
4. Open the sidebar panel. Use the peer **Entities** and **Traffic layers** buttons
   to search, inspect, show locations, or change overlay visibility.

For a dashboard, add **Open Map** in the card picker and choose content in its
visual editor. The integration automatically registers the card resource. Keep
the entire `frontend/dist/` directory when installing: the map and editor load
from separate ESM chunks. Remove old manually registered duplicate card resources.

```yaml
type: custom:openmap-card
title: Household & traffic
map_id: household-main
entities:
  - person.alex
  - zone.home
  - entity: device_tracker.phone
    name: Phone
    color: blue
overlay_layers:
  - preset: bus
    name: Bus lines & stops
    visible: true
    opacity: 0.9
  - parken
```

Traffic visibility is remembered **per signed-in user, map and browser**. It does
not edit shared defaults. Use a distinct `map_id` for cards that need independent
preferences; without it, title and content selection determine the identity.
The sidebar uses its integration entry ID. Only layer booleans are stored, never
entity locations, map center, search text or credentials. Clearing the browser’s
Open Map preferences restores configured defaults.

## Map configuration

| Option | Default | Meaning |
|---|---|---|
| `title` | `Open Map` | Visible title |
| `entities` | `[]` | IDs or `{entity, name, color}` objects |
| `include_domains` | `[]` | Explicitly include mappable entities in these domains |
| `geo_location_sources` | `[]` | `geo_location` source names; list or comma-separated text |
| `overlay_layers` | `[]` | Preset names or `{preset, name, visible, opacity}` objects |
| `map_id` | derived | Stable identity for browser visibility preferences |
| `center` | `null` | `[latitude, longitude]`; otherwise fit selected entities |
| `default_zoom` | `14` | Initial zoom / maximum automatic fit zoom, 0–20 |
| `basemap` | `osm` | `osm` or `carto` |
| `theme_mode` | `auto` | `auto`, `light`, `dark`; follows HA chrome; CARTO adapts its tiles |
| `cluster` | `true` | Group nearby locations |
| `attribution` | `""` | Additional plain-text attribution; provider credits stay visible |
| `marker.size` | `40` | Marker diameter, 24–64 CSS pixels |
| `marker.color.default` | `default` | HA accent, named color or `#RRGGBB` |
| `marker.label_mode` | `initials` | `initials`, `name`, `state`, `icon` (unlabeled location dot) |
| `marker.popup` | see below | Inspector title, body and up to 12 fields |

Entities without coordinates, missing IDs and unavailable entities remain
discoverable in the list, but do not leave stale markers on the map. Latitude or
longitude zero is valid. Zone and GPS-accuracy rings use geodesic distances.
The map caps rendering at 500 entities; intended household scale is 10–100.
Choose narrower domains rather than mapping every sensor.

```yaml
marker:
  color:
    default: blue
  popup:
    title: friendly_name
    body: "Last update: {last_updated}"
    fields:
      - label: Battery
        value: battery_level
```

Templates resolve attributes and `{state}`, `{entity_id}`, `{last_updated}`.
Everything is **text**, not HTML or JavaScript. Arbitrary templates are not
executed. Visual editing preserves supported rich entity/layer objects and nested
popup settings. Per-entry options and detailed templates can be edited in YAML.

## Ludwigsburg traffic

Presets: `baustellen`, `radverkehr`, `parken`, `bus`, `winterdienst`,
`eladestationen`. Newly selected layers are hidden unless `visible: true` is set;
remembered browser choices override that initial setting. **Show Ludwigsburg**
returns to the provider’s local service area. Empty raster tiles may simply mean
there is no data at the current location; transport failures display a retry action.

HA transports fixed **EPSG:25832** grid images from the official geoportal through
the authenticated `/api/openmap/traffic/{preset}/{z}/{x}/{y}.png` route. OpenLayers
reprojects the **pixels** into the map’s Web Mercator canvas. HA does not run GIS
or incorrectly stretch a native image into a transformed bounding box.

The backend has four concurrent upstream fetches, twelve in-flight keys, 32
waiters, a 1 MiB response limit and a 16 MiB / 128-entry LRU cache. Successful tiles
are cached for up to 30 minutes (tiny blank tiles for one minute). Requests use a
fixed provider allowlist, reject redirects and require HA authentication. Cache
and requests are released on unload. The browser also bounds traffic work and
cancels it when layers are hidden or the card disconnects.

## Basemaps and privacy

OpenStreetMap is the default. Its raster does not change with HA dark mode;
the surrounding controls do. Respect the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
OSM tiles load directly in the browser with its normal User-Agent and HTTP cache.
An image-only `strict-origin-when-cross-origin` policy sends the HA origin as the
required Referer, overriding HA's default `no-referrer` only for OSM images.
Dashboard paths, query parameters and fragments are not sent. Open Map does not
prefetch offline tiles, proxy OSM requests or bypass provider blocks.
CARTO is optional: select `basemap: carto`, then configure a **restricted,
browser-visible tile key** in the integration’s Configure dialog. Check
[CARTO’s current terms](https://carto.com/basemaps/) for eligibility and limits.
Without a key, the map explicitly falls back to OSM instead of requesting CARTO’s
key-required notice tiles.

The authenticated key endpoint is `no-store`; keys are absent from public panel
metadata and preference storage. A client tile key is **not a private API secret**:
it is necessarily visible to an authorized browser and the tile provider.
Basemap providers receive your IP and requested tile area; OSM also receives the
HA origin (scheme, hostname and port). CARTO images retain `no-referrer`.
Traffic requests pass through HA; the geoportal sees HA’s network address and
requested local grid.
No analytics or entity data are sent to Open Map servers.

## Migration from 0.3 / 0.4

This is the **1.0 configuration/renderer break**, not a drop-in visual reskin.
Back up your dashboard YAML before upgrading.

- Leaflet and its layer control are replaced by OpenLayers and the dual inspector.
- New maps start empty; existing explicit entity/domain/layer selections remain.
- Use `type: custom:openmap-card` (not `custom:openmap`).
- `geo_location_sources` is canonical. The old `geolocation_sources` alias is read
  on import, as are `dark_mode` and paired `center_lat`/`center_lon`; editors save
  canonical names. An explicitly empty canonical value wins over its old alias.
- Default zoom is 14, marker size 40, and basemap OSM. Select CARTO explicitly if
  you want its theme-aware raster. A dashboard-level `carto_api_key` is no longer
  used: move it to integration settings.
- Arbitrary popup HTML, unsafe CSS colors, Leaflet-specific pane/cluster/plugin
  settings and unsupported entity presentation keys are not supported. Icon mode
  uses a dot; the inspector uses safe HA entity icons. Text templates remain.
- Forms preserve omitted values, but explicitly submitted blanks/empty lists
  clear them. The options dialog provides **Clear CARTO key** and **Use automatic
  center** so values inherited from initial setup cannot silently reappear.
- All six inherited Ludwigsburg presets are retained. The unauthenticated old
  WMS proxy is removed. Third-party callers must not rely on the old route.
- Install all generated chunks and restart HA. The integration serves them from
  `/openmap/static/v<integration-version>/`; stale duplicate resource
  registrations must be removed.

## Development and verification

```bash
npm ci
npm run lint
npm test
npx playwright install chromium
npm run test:browser    # builds production and projection prototype, then tests both

python3.14 -m venv /tmp/opencode/openmap-ha-202611
/tmp/opencode/openmap-ha-202611/bin/pip install -r requirements_test.txt
/tmp/opencode/openmap-ha-202611/bin/python -m pytest tests/ -q
/tmp/opencode/openmap-ha-202611/bin/ruff check custom_components tests
```

Tests use matching HA Core and official `pytest-homeassistant==2026.11.1`.
Browser fixtures use synthetic native-UTM rasters and HA host stubs, not household
data. CI builds the lazy chunks, checks freshness, and runs frontend/backend and
desktop/emulated-Android regressions. Dependency audit has two known **low,
build-only** findings in `deepmerge` / node-resolve; no production advisory remains.
Do not force-downgrade the resolver to an incompatible release to silence them.

Before committing a frontend update, stage the entire generated distribution,
not just changes to files Git already tracks:

```bash
git add -A -- custom_components/openmap/frontend/dist/
npm run check:package -- --staged
```

`npm run check:package` checks the **committed HEAD**, not local files. Use
`npm run check:package -- --ref <release-tag>` to check a release candidate.
The check follows actual ESM imports and rejects missing modules/notices; an
untracked file cannot satisfy it. CI runs it **before rebuilding** so a build
cannot hide an incomplete download package. Publish only a checked commit/tag;
tests passing in a working directory do not prove that all new chunks were committed.

**Verification boundaries:** no live HA instance or physical Android device was
available for this overhaul. Real geoportal fetching timed out in this environment.
Actual Companion WebView/TalkBack behavior, physical-device performance and
live-provider content still need deployment checks. See `VALIDATION.md`.

## License

MIT. OpenLayers and bundled dependencies retain their respective licenses;
provider attribution is mandatory. Bundled license texts ship in
`custom_components/openmap/frontend/dist/THIRD_PARTY_NOTICES.txt`.
