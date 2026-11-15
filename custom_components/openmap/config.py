"""Canonical map settings and lossless form updates (frontend contract v1)."""

from copy import deepcopy
import math
from typing import Any

from .ludwigsburg_wms import LUDWIGSBURG_OVERLAY_PRESETS

DEFAULT_CONFIG = {
    "config_version": 1,
    "title": "Open Map",
    "map_id": "",
    "entities": [],
    "geo_location_sources": [],
    "include_domains": [],
    "overlay_layers": [],
    "center": None,
    "default_zoom": 14,
    "theme_mode": "auto",
    "basemap": "osm",
    "cluster": True,
    "attribution": "",
    "marker": {
        "color": {"default": "default"},
        "size": 40,
        "label_mode": "initials",
        "popup": {"title": "friendly_name", "body": "", "fields": []},
    },
}


def list_value(value: Any) -> list:
    """Normalize multi-select or comma-separated text without losing objects."""
    values = value.split(",") if isinstance(value, str) else value or []
    return [v.strip() if isinstance(v, str) else v for v in values if v]


def merge(base: dict, patch: dict) -> dict:
    """Merge nested settings while preserving explicit empty values."""
    result = deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def _aliases(settings: dict) -> dict:
    result = deepcopy(settings)
    for old, new in (
        ("geolocation_sources", "geo_location_sources"),
        ("dark_mode", "theme_mode"),
    ):
        if old in result:
            result.setdefault(new, result.pop(old))
    marker = result.setdefault("marker", {})
    for old, parent, new in (
        ("marker_color_default", "color", "default"),
        ("marker_popup_title", "popup", "title"),
        ("marker_popup_body", "popup", "body"),
    ):
        if old in result:
            marker.setdefault(parent, {})[new] = result.pop(old)
    if "center_lat" in result or "center_lon" in result:
        lat, lon = result.pop("center_lat", None), result.pop("center_lon", None)
        result["center"] = (
            None if lat in (None, "") and lon in (None, "") else [lat, lon]
        )
    return result


def canonical_config(data: dict, options: dict | None = None) -> dict:
    """Defaults < normalized initial data < normalized options; aliases cannot hide."""
    result = merge(merge(DEFAULT_CONFIG, _aliases(data)), _aliases(options or {}))
    for key in ("entities", "geo_location_sources", "include_domains"):
        result[key] = list_value(result[key])
    center = result.get("center")
    if center is not None:
        try:
            lat, lon = map(float, center)
            if (
                not math.isfinite(lat)
                or not math.isfinite(lon)
                or abs(lat) > 90
                or abs(lon) > 180
            ):
                raise ValueError
        except (ValueError, TypeError):
            raise ValueError("invalid_center") from None
        result["center"] = [lat, lon]
    if result["theme_mode"] not in ("auto", "light", "dark"):
        raise ValueError("invalid_theme")
    if result["basemap"] not in ("osm", "carto"):
        raise ValueError("invalid_basemap")
    result["default_zoom"] = min(20, max(0, float(result["default_zoom"])))
    layers = {}
    for item in list_value(result.get("overlay_layers")):
        preset = (
            item
            if isinstance(item, str)
            else item.get("preset", item.get("layer", item.get("value")))
        )
        if preset not in LUDWIGSBURG_OVERLAY_PRESETS:
            continue
        raw = item if isinstance(item, dict) else {}
        opacity = raw.get("opacity", 0.9)
        layers[preset] = {
            "preset": preset,
            "name": str(raw.get("name") or LUDWIGSBURG_OVERLAY_PRESETS[preset]["name"])[
                :100
            ],
            "visible": raw.get("visible") is True,
            "opacity": min(1, max(0, opacity))
            if isinstance(opacity, (int, float)) and math.isfinite(opacity)
            else 0.9,
        }
    result["overlay_layers"] = list(layers.values())
    result["config_version"] = 1
    return result


def apply_form(data: dict, options: dict, form: dict) -> dict:
    """Omitted fields retain values; submitted blanks/lists clear values."""
    previous = canonical_config(data, options)
    patch = deepcopy(form)
    if patch.pop("clear_carto_key", False):
        patch["carto_api_key"] = ""
    if patch.pop("clear_center", False):
        patch.pop("center_lat", None)
        patch.pop("center_lon", None)
        patch["center"] = None
    for key, id_key in (("entities", "entity"), ("overlay_layers", "preset")):
        if key not in patch:
            continue
        old = {
            item if isinstance(item, str) else item[id_key]: item
            for item in previous[key]
        }
        patch[key] = [
            old.get(item, item) if isinstance(item, str) else item
            for item in list_value(patch[key])
        ]
    return canonical_config(previous, patch)
