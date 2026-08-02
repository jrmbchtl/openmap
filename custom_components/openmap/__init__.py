"""The Open Map integration."""

import logging
import os

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady

from .const import DOMAIN, VERSION

_LOGGER = logging.getLogger(__name__)

# The built bundle includes both the card and its visual editor.
# Use a versioned URL so every release serves a fresh path and can never
# be served from a stale browser/service-worker cache.
JS_PATH = f"/api/openmap/v{VERSION}/openmap-card.js"
PANEL_URL_PATH = "openmap"
WEBCOMPONENT_NAME = "openmap-card"

PLATFORMS = ["diagnostics"]

# Defaults for the sidebar panel card. The options flow writes to
# config_entry.options, which is merged over these defaults so the
# "Configure" dialog actually controls the sidebar map.
DEFAULT_PANEL_CONFIG = {
    "title": "Open Map",
    "default_zoom": 14,
    "theme_mode": "auto",
    "cluster": True,
    "entities": [],
    "geo_location_sources": [],
    "include_domains": [],
    "attribution": "",
    "marker": {
        "color": {"default": "default"},
        "size": 48,
        "label_mode": "initials",
        "popup": {},
    },
}


def _panel_config_from_entry(entry: ConfigEntry) -> dict:
    """Build the sidebar panel card config from entry data/options."""
    config = {**DEFAULT_PANEL_CONFIG}
    config.update(entry.options or {})
    # Honor values set during the initial setup for keys options didn't touch.
    for key, value in (entry.data or {}).items():
        if value is not None and value != "":
            config.setdefault(key, value)
    return config


async def _register_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """(Re)register the sidebar panel using the entry's options as card config."""
    try:
        # Remove any existing panel first so re-registration is safe.
        try:
            if hass.components.frontend.get_panel(PANEL_URL_PATH) is not None:
                hass.components.frontend.async_remove_panel(PANEL_URL_PATH)
        except (AttributeError, KeyError, ValueError):
            pass
        await async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=WEBCOMPONENT_NAME,
            sidebar_title="Open Map",
            sidebar_icon="mdi:map",
            module_url=JS_PATH,
            require_admin=False,
            config=_panel_config_from_entry(entry),
        )
        hass.data.setdefault(DOMAIN, {})["_panel_registered"] = True
        _LOGGER.debug("Registered sidebar panel for entry %s", entry.entry_id)
    except Exception as err:
        _LOGGER.exception("Failed to register sidebar panel")
        raise ConfigEntryNotReady("Failed to register sidebar panel") from err


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
        # Versioned URL is immutable per release, so long-lived caching is safe.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(JS_PATH, local_card_path, cache_headers=True)]
        )
        _LOGGER.debug("Registered static path for %s", JS_PATH)
    except Exception as err:
        _LOGGER.exception("Failed to register static path")
        raise ConfigEntryNotReady("Failed to register static path") from err

    # Register JS as an extra resource so Lovelace loads it automatically.
    add_extra_js_url(hass, JS_PATH)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Open Map from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    entries = domain_data.setdefault("_entries", {})
    entries[entry.entry_id] = entry

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    await _register_panel(hass, entry)

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
