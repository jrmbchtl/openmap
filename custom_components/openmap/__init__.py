"""The Open Map integration."""

import logging

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

JS_PATH = "/api/openmap/openmap-card.js"
EDITOR_JS_PATH = "/api/openmap/openmap-card-editor.js"
PANEL_URL_PATH = "openmap"
WEBCOMPONENT_NAME = "openmap-card"

PLATFORMS = ["diagnostics"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Open Map from a config entry."""

    domain_data = hass.data.setdefault(DOMAIN, {})
    entries = domain_data.setdefault("_entries", {})
    entries[entry.entry_id] = entry

    local_card_path = hass.config.path("custom_components/openmap/openmap-card.js")
    local_editor_path = hass.config.path("custom_components/openmap/openmap-card-editor.js")

    if not domain_data.get("_static_registered"):
        try:
            await hass.http.async_register_static_paths([
                StaticPathConfig(JS_PATH, local_card_path, cache_headers=True),
                StaticPathConfig(EDITOR_JS_PATH, local_editor_path, cache_headers=True),
            ])
            domain_data["_static_registered"] = True
            _LOGGER.debug("Registered static paths for %s and %s", JS_PATH, EDITOR_JS_PATH)
        except Exception as err:
            _LOGGER.exception("Failed to register static paths")
            entries.pop(entry.entry_id, None)
            raise ConfigEntryNotReady("Failed to register static paths") from err

    if not domain_data.get("_panel_registered"):
        try:
            await async_register_panel(
                hass,
                frontend_url_path=PANEL_URL_PATH,
                webcomponent_name=WEBCOMPONENT_NAME,
                sidebar_title="Open Map",
                sidebar_icon="mdi:map",
                module_url=JS_PATH,
                require_admin=False,
            )
            domain_data["_panel_registered"] = True
            _LOGGER.debug("Registered sidebar panel")
        except Exception as err:
            _LOGGER.exception("Failed to register sidebar panel")
            entries.pop(entry.entry_id, None)
            raise ConfigEntryNotReady("Failed to register sidebar panel") from err

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    _LOGGER.info("Open Map setup complete for entry %s", entry.entry_id)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload an Open Map config entry."""

    domain_data = hass.data.get(DOMAIN, {})
    entries = domain_data.get("_entries", {})

    entries.pop(entry.entry_id, None)

    unload_ok = True

    if not entries and domain_data.get("_panel_registered"):
        try:
            hass.components.frontend.async_remove_panel(PANEL_URL_PATH)
            domain_data["_panel_registered"] = False
            _LOGGER.debug("Removed sidebar panel")
        except AttributeError:
            _LOGGER.warning("async_remove_panel not available in this HA version")
        except Exception as err:
            _LOGGER.exception("Failed to remove panel")
            unload_ok = False

    if not entries:
        hass.data.pop(DOMAIN, None)

    _LOGGER.info("Open Map unloaded for entry %s", entry.entry_id)
    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry when options are updated."""
    _LOGGER.debug("Reloading Open Map entry %s due to options update", entry.entry_id)
    await hass.config_entries.async_reload(entry.entry_id)


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate old entry."""
    _LOGGER.debug("Migrating Open Map configuration from version %s", entry.version)
    return True