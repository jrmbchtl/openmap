"""The Open Map integration."""

from functools import lru_cache
import logging
import os

from homeassistant.components.frontend import (
    add_extra_js_url,
    async_panel_exists,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .http import async_register_http_views

_LOGGER = logging.getLogger(__name__)

PANEL_URL_PATH = "openmap"
WEBCOMPONENT_NAME = "openmap-card"

# hass.data key tracking static paths already registered this run; separate
# from the DOMAIN dict so entry unload/reload cannot reset it.
_REGISTERED_STATIC_PATHS = f"{DOMAIN}_registered_static_paths"

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
    """Build the sidebar panel card config from entry data/options.

    Precedence: built-in defaults < entry.data (initial setup) < entry.options.
    """
    config = {**DEFAULT_PANEL_CONFIG}
    for key, value in (entry.data or {}).items():
        if value is not None and value != "":
            config[key] = value
    config.update(entry.options or {})
    return config


@lru_cache(maxsize=1)
def _js_url(version: str) -> str:
    """Return the versioned URL under our own integration namespace.

    A versioned path guarantees every release is served from a fresh URL and
    can never be answered from a stale browser/service-worker cache.
    """
    return f"/openmap/static/v{version}/openmap-card.js"


def _local_card_path(hass: HomeAssistant) -> str:
    """Return the path of the built card bundle."""
    return hass.config.path(
        "custom_components/openmap/frontend/dist/openmap-card.js"
    )


async def _async_register_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """(Re)register the sidebar panel using the entry's options as card config."""
    version = await _async_integration_version(hass)
    module_url = _js_url(version)

    # Re-registration is only safe after removing an existing panel;
    # async_register_built_in_panel raises ValueError otherwise.
    if async_panel_exists(hass, PANEL_URL_PATH):
        async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)

    try:
        await async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=WEBCOMPONENT_NAME,
            sidebar_title="Open Map",
            sidebar_icon="mdi:map",
            module_url=module_url,
            require_admin=False,
            config=_panel_config_from_entry(entry),
            # The panel element applies the safe-area insets itself (see
            # openmap-card.js), so opt out of the host padding to avoid
            # doubling them.
            handle_safe_area=True,
        )
    except (HomeAssistantError, ValueError) as err:
        _LOGGER.exception("Failed to register sidebar panel")
        raise ConfigEntryNotReady("Failed to register sidebar panel") from err
    _LOGGER.debug("Registered sidebar panel for entry %s", entry.entry_id)


async def _async_integration_version(hass: HomeAssistant) -> str:
    """Return the integration version from its manifest (single source of truth)."""
    integration = await async_get_integration(hass, DOMAIN)
    return str(integration.version)


async def _async_register_static_path(hass: HomeAssistant) -> str:
    """Serve the built card bundle and return its versioned URL."""
    version = await _async_integration_version(hass)
    url = _js_url(version)

    # The versioned URL can only change across a restart (it comes from the
    # installed manifest), and re-registering would stack duplicate aiohttp
    # routes on every entry reload, so register once per HA run. The flag
    # lives OUTSIDE hass.data[DOMAIN] because unloading the last entry pops
    # that dict, and a subsequent reload would re-register otherwise.
    registered: set[str] = hass.data.setdefault(_REGISTERED_STATIC_PATHS, set())
    if url in registered:
        return url

    local_path = _local_card_path(hass)
    if not os.path.isfile(local_path):
        raise ConfigEntryNotReady(
            "Built card file not found at "
            f"{local_path}. Run 'npm run build' in the integration directory."
        )

    try:
        # Versioned URL is immutable per release, so long-lived caching is safe.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(url, local_path, cache_headers=True)]
        )
    except (HomeAssistantError, ValueError) as err:
        _LOGGER.exception("Failed to register static path")
        raise ConfigEntryNotReady("Failed to register static path") from err
    registered.add(url)
    _LOGGER.debug("Registered static path for %s", url)
    return url


@callback
def _async_add_extra_js(hass: HomeAssistant, url: str) -> None:
    """Register the bundle so Lovelace loads it automatically."""
    add_extra_js_url(hass, url)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Open Map from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    url = await _async_register_static_path(hass)
    _async_add_extra_js(hass, url)
    async_register_http_views(hass)
    await _async_register_panel(hass, entry)

    domain_data.setdefault("entries", {})[entry.entry_id] = entry
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    _LOGGER.info("Open Map setup complete for entry %s", entry.entry_id)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload an Open Map config entry."""
    domain_data = hass.data.get(DOMAIN, {})
    entries: dict = domain_data.get("entries", {})

    entries.pop(entry.entry_id, None)

    if not entries:
        if async_panel_exists(hass, PANEL_URL_PATH):
            async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
            _LOGGER.debug("Removed sidebar panel")
        hass.data.pop(DOMAIN, None)

    _LOGGER.info("Open Map unloaded for entry %s", entry.entry_id)
    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry when options are updated."""
    _LOGGER.debug("Reloading Open Map entry %s due to options update", entry.entry_id)
    await hass.config_entries.async_reload(entry.entry_id)
