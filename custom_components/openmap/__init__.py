import logging

from homeassistant.components import frontend
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

_LOGGER = logging.getLogger(__name__)
DOMAIN = "openmap"

JS_PATH = "/api/openmap/openmap-card.js"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    local_path = hass.config.path("custom_components/openmap/openmap-card.js")

    hass.http.register_static_path(JS_PATH, local_path, cache_headers=False)

    frontend.add_extra_js_url(hass, JS_PATH)

    await async_register_panel(
        hass,
        frontend_url_path="openmap",
        webcomponent_name="openmap-card",
        sidebar_title="Open Map",
        sidebar_icon="mdi:map",
        module_url=JS_PATH,
        require_admin=False,
    )

    _LOGGER.info("Open Map panel and card registered")
    return True
