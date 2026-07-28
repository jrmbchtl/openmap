from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import aiohttp
import async_timeout

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.helpers.storage import Store

from .const import (
    DOMAIN,
    CONF_OVERLAYS,
    CONF_DATA_URL,
    CONF_OVERLAY_TYPE,
    CONF_MARKER_CONFIG,
    CONF_FILTER_BBOX,
    CONF_UPDATE_INTERVAL,
    STORAGE_KEY,
    STORAGE_VERSION,
    SERVICE_REGISTER_OVERLAY,
    SERVICE_UNREGISTER_OVERLAY,
    EVENT_OVERLAY_UPDATED,
)

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(minutes=30)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {"overlays": {}, "coordinators": {}})

    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)

    async def handle_register_overlay(call: ServiceCall) -> None:
        name = call.data.get("name")
        if not name:
            _LOGGER.error("register_overlay requires a 'name' field")
            return

        data_url = call.data.get(CONF_DATA_URL)
        overlay_type = call.data.get(CONF_OVERLAY_TYPE, "geojson")
        marker_type = call.data.get("marker_type", "default")
        filter_bbox = call.data.get(CONF_FILTER_BBOX)
        update_interval = call.data.get(CONF_UPDATE_INTERVAL, 1800)

        overlay_config = {
            "name": name,
            CONF_DATA_URL: data_url,
            CONF_OVERLAY_TYPE: overlay_type,
            CONF_MARKER_CONFIG: {"type": marker_type},
            CONF_FILTER_BBOX: filter_bbox,
            CONF_UPDATE_INTERVAL: update_interval,
        }

        hass.data[DOMAIN]["overlays"][name] = overlay_config

        if overlay_type == "geojson" and data_url:
            coordinator = OpenMapCoordinator(
                hass,
                _LOGGER,
                name=name,
                data_url=data_url,
                filter_bbox=filter_bbox,
                update_interval=update_interval,
            )
            hass.data[DOMAIN]["coordinators"][name] = coordinator
            await coordinator.async_refresh()

        hass.bus.async_fire(EVENT_OVERLAY_UPDATED, {"name": name, "action": "registered"})

        stored = await store.async_load() or []
        existing = [o for o in stored if o.get("name") != name]
        existing.append(overlay_config)
        await store.async_save(existing)

    async def handle_unregister_overlay(call: ServiceCall) -> None:
        name = call.data.get("name")
        if not name:
            _LOGGER.error("unregister_overlay requires a 'name' field")
            return

        hass.data[DOMAIN]["overlays"].pop(name, None)
        coordinator = hass.data[DOMAIN]["coordinators"].pop(name, None)
        if coordinator:
            await coordinator.async_shutdown()

        hass.bus.async_fire(EVENT_OVERLAY_UPDATED, {"name": name, "action": "unregistered"})

        stored = await store.async_load() or []
        await store.async_save([o for o in stored if o.get("name") != name])

    hass.services.async_register(DOMAIN, SERVICE_REGISTER_OVERLAY, handle_register_overlay)
    hass.services.async_register(DOMAIN, SERVICE_UNREGISTER_OVERLAY, handle_unregister_overlay)

    stored = await store.async_load() or []
    for config in stored:
        name = config.get("name")
        if name:
            hass.data[DOMAIN]["overlays"][name] = config

    _LOGGER.info("Open Map integration initialized with %d stored overlays", len(stored))
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return True


class OpenMapCoordinator(DataUpdateCoordinator):
    def __init__(
        self,
        hass: HomeAssistant,
        logger: logging.Logger,
        name: str,
        data_url: str,
        filter_bbox: list[float] | None = None,
        update_interval: int = 1800,
    ) -> None:
        self._data_url = data_url
        self._filter_bbox = filter_bbox
        super().__init__(
            hass,
            logger,
            name=name,
            update_interval=timedelta(seconds=update_interval),
        )

    async def _async_update_data(self) -> list[dict[str, Any]]:
        try:
            async with async_timeout.timeout(30):
                async with aiohttp.ClientSession() as session:
                    async with session.get(self._data_url) as response:
                        if response.status != 200:
                            raise UpdateFailed(
                                f"HTTP {response.status} from {self._data_url}"
                            )
                        data = await response.json()
        except aiohttp.ClientError as err:
            raise UpdateFailed(f"Connection error: {err}") from err
        except asyncio.TimeoutError as err:
            raise UpdateFailed(f"Timeout fetching {self._data_url}") from err

        features = data.get("features", [])
        if self._filter_bbox:
            features = self._filter_by_bbox(features, self._filter_bbox)

        return features

    @staticmethod
    def _filter_by_bbox(
        features: list[dict], bbox: list[float]
    ) -> list[dict]:
        min_lon, min_lat, max_lon, max_lat = bbox
        result = []
        for feature in features:
            coords = _get_feature_coords(feature)
            if not coords:
                continue
            for lon, lat in coords:
                if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                    result.append(feature)
                    break
        return result


def _get_feature_coords(feature: dict) -> list[tuple[float, float]] | None:
    geometry = feature.get("geometry")
    if not geometry:
        return None
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if geom_type == "Point":
        return [coords]
    if geom_type in ("LineString", "MultiPoint"):
        return coords
    if geom_type in ("Polygon", "MultiLineString"):
        return coords[0] if coords else None
    if geom_type == "MultiPolygon":
        return coords[0][0] if coords and coords[0] else None
    return None
