"""Fixed native-projection grid and Ludwigsburg geoportal presets.

The Stadt Ludwigsburg TBview2 client (logis2.ludwigsburg.de/tbview2) serves
its "Verkehr" topics through a mapagent endpoint that behaves like a WMS
service. The upstream only renders in the native map projection
(EPSG:25832, UTM zone 32N) and silently returns a blank image when asked for
Web-Mercator (EPSG:3857). The browser reprojects native tiles; HA only
constructs fixed-grid requests and transports bounded image responses.

The layer ids below were extracted from the inline ``TBView.Map.addLayer*``
definitions in the workspace page source.
"""

from __future__ import annotations

from urllib.parse import quote

MAPAGENT_BASE = "https://logis2.ludwigsburg.de/tbview2/services/mapagent.php"
UPSTREAM_REFERER = "https://logis2.ludwigsburg.de/tbview2/index.php"

# Shared connection id for all QGIS-server backed projects.
_QGIS_CONNECTION = "8A2C9E8D-62F8-3B6A-E99F-37AC8CC3D268"
# Separate WMS connection for the Baustellen (construction sites) layer.
_BAUSTELLEN_CONNECTION = "BD3F18E0-B690-1597-1303-7C64AD87CDC0"

_RADVERKEHR_LAYERS = ",".join(
    [
        "RadSERVICE",
        "Regiorad",
        "Winterdienst",
        "Radrouten",
        "Radschulwege",
        "Befahren verboten",
        "Schutzstreifen",
        "Radfahrstreifen",
        "Mischverkehr",
        "Eigenständige Führung",
        "Fahrradstraße",
        "erig",
        "Furt Fuß-Radverkehr",
        "Furt Radverkehr",
        "Furt Fußverkehr",
        "Radständer",
    ]
)

# preset key -> overlay definition
LUDWIGSBURG_OVERLAY_PRESETS: dict[str, dict[str, str]] = {
    "baustellen": {
        "name": "Baustellen",
        "connection": _BAUSTELLEN_CONNECTION,
        "project": "",
        "layers": "Baustellen",
    },
    "radverkehr": {
        "name": "Radverkehr",
        "connection": _QGIS_CONNECTION,
        "project": "4af1a7a6cc0e133e92c8aa2a336da27a",
        "layers": _RADVERKEHR_LAYERS,
    },
    "parken": {
        "name": "Parken",
        "connection": _QGIS_CONNECTION,
        "project": "01af4110f4a47e8992fff590d0bb24a4",
        "layers": "Parkzonen,Parken Innenstadt",
    },
    "bus": {
        "name": "Bus",
        "connection": _QGIS_CONNECTION,
        "project": "260a876af492fe7848094b7c437dcfef",
        "layers": "Linienübersicht,Bushaltestellen",
    },
    "winterdienst": {
        "name": "Winterdienst",
        "connection": _QGIS_CONNECTION,
        "project": "d6d73b365da441dae39554463c0244aa",
        "layers": "Winterdienst Straßen,Streuboxen",
    },
    "eladestationen": {
        "name": "E-Ladestationen",
        "connection": _QGIS_CONNECTION,
        "project": "2f6fe4f5f8ab60beeb8897b3cfb9279b",
        "layers": "E-Ladestationen",
    },
}

NATIVE_EXTENT = (490000, 5390000, 540000, 5440000)
NATIVE_RESOLUTIONS = tuple(128 / 2**z for z in range(10))
TILE_SIZE = 256


def native_tile_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Validate a tile intersects the local service area; return its UTM bbox."""
    if not 0 <= z < len(NATIVE_RESOLUTIONS) or not 0 <= x <= 2000 or not 0 <= y <= 2000:
        raise ValueError("invalid tile")
    span = TILE_SIZE * NATIVE_RESOLUTIONS[z]
    west = NATIVE_EXTENT[0] + x * span
    north = NATIVE_EXTENT[3] - y * span
    if west >= NATIVE_EXTENT[2] or north <= NATIVE_EXTENT[1]:
        raise ValueError("tile outside service area")
    return west, north - span, west + span, north


def build_upstream_url(preset: dict[str, str], z: int, x: int, y: int) -> str:
    """Build a fixed native-grid GetMap URL; never accepts a caller URL/bbox."""
    bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y = native_tile_bbox(z, x, y)

    url = f"{MAPAGENT_BASE}?connection={quote(preset['connection'])}&"
    if preset["project"]:
        url += f"project={quote(preset['project'])}&map=project&"
    bbox = f"{bbox_min_x:.3f},{bbox_min_y:.3f},{bbox_max_x:.3f},{bbox_max_y:.3f}"
    url += (
        "request=GetMap"
        f"&layers={quote(preset['layers'], safe=',')}"
        "&format=image/png"
        "&transparent=true"
        "&version=1.1.0"
        f"&bbox={quote(bbox)}"
        "&width=256&height=256&srs=EPSG:25832"
    )
    return url
