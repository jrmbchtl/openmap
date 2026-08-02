"""Diagnostics support for Open Map integration."""

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN

TO_REDACT = {
    "latitude",
    "longitude",
    "elevation",
    "center_lat",
    "center_lon",
    "center",
}

async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry):
    """Return diagnostics for a config entry."""
    # Redact sensitive location data from both entry data and options
    data = {**entry.data, **entry.options}
    return async_redact_data(data, TO_REDACT)