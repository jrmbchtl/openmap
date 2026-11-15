"""Authenticated, same-origin Open Map HTTP views."""

import time

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.http.const import KEY_HASS
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .ludwigsburg_wms import native_tile_bbox
from .tiles import TileBusyError, TileError

_VIEWS_REGISTERED = f"{DOMAIN}_views_registered"


@callback
def async_register_http_views(hass: HomeAssistant) -> None:
    """Register stable routes once; views resolve the currently loaded runtime."""
    if hass.data.get(_VIEWS_REGISTERED):
        return
    hass.http.register_view(CartoApiKeyView())
    hass.http.register_view(LudwigsburgWmsView())
    hass.data[_VIEWS_REGISTERED] = True


class CartoApiKeyView(HomeAssistantView):
    """A restricted client-side tile credential, intentionally browser-visible."""

    url = "/api/openmap/basemap_key"
    name = "api:openmap:basemap_key"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app[KEY_HASS]
        for entry in hass.config_entries.async_entries(DOMAIN):
            if entry.disabled_by is None:
                key = entry.options.get(
                    "carto_api_key", entry.data.get("carto_api_key")
                )
                if key:
                    response = self.json({"carto_api_key": key})
                    response.headers["Cache-Control"] = "no-store"
                    return response
        response = self.json(None, status_code=404)
        response.headers["Cache-Control"] = "no-store"
        return response


class LudwigsburgWmsView(HomeAssistantView):
    """Transport fixed EPSG:25832 tiles; the browser reprojects their pixels."""

    url = "/api/openmap/traffic/{preset}/{z}/{x}/{y}.png"
    name = "api:openmap:traffic"
    requires_auth = True

    async def get(
        self, request: web.Request, preset: str, z: str, x: str, y: str
    ) -> web.Response:
        from .ludwigsburg_wms import LUDWIGSBURG_OVERLAY_PRESETS

        if preset not in LUDWIGSBURG_OVERLAY_PRESETS:
            return self._error("Unknown traffic layer", 404)
        try:
            coords = int(z), int(x), int(y)
            native_tile_bbox(*coords)
        except ValueError:
            return self._error("Tile outside service area", 404)
        hass: HomeAssistant = request.app[KEY_HASS]
        runtime = next(
            (
                entry.runtime_data
                for entry in hass.config_entries.async_entries(DOMAIN)
                if entry.state is ConfigEntryState.LOADED
                and hasattr(entry, "runtime_data")
                and not entry.runtime_data.tiles.closed
            ),
            None,
        )
        if runtime is None:
            return self._error("Open Map is not loaded", 503)
        try:
            tile = await runtime.tiles.get((preset, *coords))
        except TileBusyError:
            response = self._error("Traffic service is busy; retry shortly", 429)
            response.headers["Retry-After"] = "2"
            return response
        except TileError as err:
            return self._error(str(err), 502)
        max_age = max(0, int(tile.expires - time.monotonic()))
        return web.Response(
            body=tile.body,
            content_type=tile.content_type,
            headers={
                "Cache-Control": f"private, max-age={max_age}",
                "X-Content-Type-Options": "nosniff",
                "X-OpenMap-Fetched-At": str(int(tile.fetched_at)),
            },
        )

    @staticmethod
    def _error(message: str, status: int) -> web.Response:
        response = web.json_response({"error": message}, status=status)
        response.headers["Cache-Control"] = "no-store"
        return response
