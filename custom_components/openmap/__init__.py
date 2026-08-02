"""The Open Map integration."""

import logging
import os

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# The built bundle includes both the card and its visual editor.
JS_PATH = "/api/openmap/openmap-card.js"
PANEL_URL_PATH = "openmap"
WEBCOMPONENT_NAME = "openmap-card"

PLATFORMS = ["diagnostics"]


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up Open Map integration (called at HA startup)."""
    local_card_path = hass.config.path(
        "custom_components/openmap/frontend/dist/openmap-card.js"
    )

    if not os.path.exists(local_card_path):
        _LOGGER.error(
            "Built card file not found at %s. Run 'npm run build' in the "
            "integration directory.",
            local_card_path,
        )
        return False

    try:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(JS_PATH, local_card_path, cache_headers=False)]
        )
        _LOGGER.debug("Registered static path for %s", JS_PATH)
    except Exception as err:
        _LOGGER.exception("Failed to register static path")
        raise ConfigEntryNotReady("Failed to register static path") from err

    # Register JS as an extra resource so Lovelace loads it automatically.
    add_extra_js_url(hass, JS_PATH)

    # Register sidebar panel
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
        _LOGGER.debug("Registered sidebar panel")
    except Exception as err:
        _LOGGER.exception("Failed to register sidebar panel")
        raise ConfigEntryNotReady("Failed to register sidebar panel") from err

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Open Map from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    entries = domain_data.setdefault("_entries", {})
    entries[entry.entry_id] = entry

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