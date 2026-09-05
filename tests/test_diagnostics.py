"""Test Open Map diagnostics."""

from __future__ import annotations

from homeassistant.components.diagnostics import (
    _DIAGNOSTICS_DATA,
    DiagnosticsData,
    DiagnosticsPlatformData,
    async_redact_data,
)
from homeassistant.core import HomeAssistant

from custom_components.openmap.const import DOMAIN
from custom_components.openmap.diagnostics import (
    TO_REDACT,
    async_get_config_entry_diagnostics,
)

REDACTED = "**REDACTED**"


async def test_diagnostics_redacts_location(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Location values in data and options are redacted."""
    hass.config_entries.async_update_entry(
        mock_config_entry,
        data={"title": "Open Map", "center_lat": 48.8, "center_lon": 9.2},
        options={"entities": ["person.home"], "center": [48.8, 9.2]},
    )
    await hass.async_block_till_done()

    diag = await async_get_config_entry_diagnostics(hass, mock_config_entry)
    entry = diag["entry"]
    assert entry["data"]["center_lat"] == REDACTED
    assert entry["data"]["center_lon"] == REDACTED
    assert entry["data"]["title"] == "Open Map"
    assert entry["options"]["center"] == REDACTED
    assert entry["options"]["entities"] == ["person.home"]


async def test_diagnostics_is_registered(hass: HomeAssistant) -> None:
    """The integration exposes a config entry diagnostics handler."""
    hass.data[_DIAGNOSTICS_DATA] = DiagnosticsData()
    from custom_components.openmap import diagnostics

    hass.data[_DIAGNOSTICS_DATA].platforms[DOMAIN] = DiagnosticsPlatformData(
        diagnostics.async_get_config_entry_diagnostics,
        getattr(diagnostics, "async_get_device_diagnostics", None),
    )
    info = hass.data[_DIAGNOSTICS_DATA].platforms[DOMAIN]
    assert info.config_entry_diagnostics is not None


async def test_redact_helper_matches_expected_keys() -> None:
    """The redaction list covers the documented location keys."""
    data = {
        "latitude": 1.0,
        "longitude": 2.0,
        "elevation": 3.0,
        "center_lat": 4.0,
        "center_lon": 5.0,
        "center": [1.0, 2.0],
        "title": "ok",
    }
    redacted = async_redact_data(data, TO_REDACT)
    for key in TO_REDACT:
        assert redacted[key] == REDACTED
    assert redacted["title"] == "ok"
