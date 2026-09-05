"""Test setup, reload and unload of the Open Map integration."""

from __future__ import annotations

from unittest.mock import patch

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.openmap import (
    DEFAULT_PANEL_CONFIG,
    PANEL_URL_PATH,
    _panel_config_from_entry,
)
from custom_components.openmap.const import DOMAIN


async def test_setup_registers_panel(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Setting up the entry registers the sidebar panel."""
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    assert mock_config_entry.state is ConfigEntryState.LOADED
    assert hass.data[DOMAIN]["entries"][mock_config_entry.entry_id] is (
        mock_config_entry
    )
    panel = hass.data["frontend_panels"][PANEL_URL_PATH]
    assert panel.component_name == "custom"
    assert panel.sidebar_icon == "mdi:map"
    # The bundle must be served under our own namespace (not /api/).
    assert panel.config["_panel_custom"]["module_url"].startswith("/openmap/")
    # The panel opts out of host safe-area padding (handled by the element).
    assert panel.config["_panel_custom"]["handle_safe_area"] is True


async def test_setup_missing_bundle_not_ready(
    hass: HomeAssistant,
    mock_config_entry,
    mock_built_card,
) -> None:
    """A missing built bundle retries setup (ConfigEntryNotReady)."""
    mock_built_card.unlink()

    with patch(
        "custom_components.openmap._async_integration_version",
        return_value="0.3.0",
    ):
        assert not await hass.config_entries.async_setup(
            mock_config_entry.entry_id
        )
    await hass.async_block_till_done()
    assert mock_config_entry.state is ConfigEntryState.SETUP_RETRY


async def test_options_update_reloads_without_error(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Changing options re-registers the panel without a ValueError."""
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    hass.config_entries.async_update_entry(
        mock_config_entry,
        options={"title": "Renamed Map", "default_zoom": 8},
    )
    await hass.async_block_till_done()

    assert mock_config_entry.state is ConfigEntryState.LOADED
    panel = hass.data["frontend_panels"][PANEL_URL_PATH]
    assert panel.config["title"] == "Renamed Map"
    assert panel.config["default_zoom"] == 8


async def test_unload_removes_panel(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Unloading the last entry removes the sidebar panel."""
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    assert PANEL_URL_PATH in hass.data["frontend_panels"]

    assert await hass.config_entries.async_unload(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    assert mock_config_entry.state is ConfigEntryState.NOT_LOADED
    assert PANEL_URL_PATH not in hass.data["frontend_panels"]
    assert DOMAIN not in hass.data


async def test_unload_second_entry_keeps_panel(
    hass: HomeAssistant,
) -> None:
    """The panel survives while another entry is still loaded."""
    entry1 = MockConfigEntry(domain=DOMAIN, unique_id=f"{DOMAIN}-1")
    entry2 = MockConfigEntry(domain=DOMAIN, unique_id=f"{DOMAIN}-2")
    entry1.add_to_hass(hass)
    entry2.add_to_hass(hass)

    # Setting up the component loads every entry of the domain at once.
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    assert entry1.state is ConfigEntryState.LOADED
    assert entry2.state is ConfigEntryState.LOADED
    assert PANEL_URL_PATH in hass.data["frontend_panels"]

    assert await hass.config_entries.async_unload(entry1.entry_id)
    await hass.async_block_till_done()
    assert PANEL_URL_PATH in hass.data["frontend_panels"]

    assert await hass.config_entries.async_unload(entry2.entry_id)
    await hass.async_block_till_done()
    assert PANEL_URL_PATH not in hass.data["frontend_panels"]


def test_panel_config_from_entry() -> None:
    """Options override defaults; non-empty data fills the rest."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"title": "From Data", "default_zoom": 9},
        options={"title": "From Options", "entities": ["person.x"]},
    )
    config = _panel_config_from_entry(entry)
    assert config["title"] == "From Options"
    assert config["default_zoom"] == 9
    assert config["entities"] == ["person.x"]
    assert config["cluster"] is True
    for key in DEFAULT_PANEL_CONFIG:
        assert key in config
