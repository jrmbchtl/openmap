"""HTTP views for Open Map."""

from __future__ import annotations

from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


@callback
def async_register_http_views(hass: HomeAssistant) -> None:
    """Register the Open Map HTTP views."""
    hass.http.register_view(CartoApiKeyView())


class CartoApiKeyView(HomeAssistantView):
    """Serve the CARTO basemap API key to authenticated frontend clients.

    The key is a client-side tile key by design: the browser must include it
    in every tile request, so it cannot be kept secret from the frontend.
    The endpoint is behind authentication so the key is not exposed to the
    local network at large, and lets every Lovelace card share the key
    configured in the integration's options flow.
    """

    url = "/api/openmap/basemap_key"
    name = "api:openmap:basemap_key"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        """Return the configured CARTO API key, if any."""
        hass: HomeAssistant = request.app["hass"]
        key: str | None = None
        for entry in hass.config_entries.async_entries(DOMAIN):
            if entry.disabled_by is not None:
                continue
            candidate = entry.options.get("carto_api_key") or entry.data.get(
                "carto_api_key"
            )
            if candidate:
                key = candidate
                break

        if not key:
            return self.json(None, status_code=404)
        payload: dict[str, Any] = {"carto_api_key": key}
        return self.json(payload)
