"""Test the Open Map config flow."""

from __future__ import annotations

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.openmap.const import DOMAIN


async def test_user_flow_shows_form(hass: HomeAssistant) -> None:
    """The user step shows a form."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "user"
    assert result["errors"] is None


async def test_user_flow_creates_entry(hass: HomeAssistant) -> None:
    """Completing the user step creates an entry."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"title": "My Map"}
    )
    await hass.async_block_till_done()

    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert result["title"] == "Open Map"
    assert result["data"] == {"title": "My Map"}

    entries = hass.config_entries.async_entries(DOMAIN)
    assert len(entries) == 1
    assert entries[0].unique_id == DOMAIN


async def test_single_instance(hass: HomeAssistant, mock_config_entry) -> None:
    """A second config entry is aborted (single instance allowed)."""
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] == FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_options_flow_round_trip(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Options flow saves values into entry.options."""
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(
        mock_config_entry.entry_id
    )
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "init"

    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            "title": "Family Map",
            "default_zoom": 10,
            "theme_mode": "dark",
            "cluster": False,
            "attribution": "© me",
            "carto_api_key": "my-carto-key",
            "entities": ["person.home"],
            "geolocation_sources": "gpslogger, icloud",
            "include_domains": ["zone", "device_tracker"],
            "marker_color_default": "blue",
            "marker_popup_title": "friendly_name",
            "marker_popup_body": "Last seen: {last_seen}",
        },
    )
    await hass.async_block_till_done()

    assert result["type"] == FlowResultType.CREATE_ENTRY
    options = mock_config_entry.options
    assert options["title"] == "Family Map"
    assert options["default_zoom"] == 10
    assert options["theme_mode"] == "dark"
    assert options["cluster"] is False
    assert options["carto_api_key"] == "my-carto-key"
    assert options["entities"] == ["person.home"]
    # Comma-separated text input is normalized into a clean list.
    assert options["geolocation_sources"] == ["gpslogger", "icloud"]
    assert options["include_domains"] == ["zone", "device_tracker"]
    assert options["marker"]["color"]["default"] == "blue"
    assert options["marker"]["popup"]["body"] == "Last seen: {last_seen}"

    # Empty optional values are dropped, not stored.
    assert "center_lat" not in options
    assert "center_lon" not in options


async def test_options_flow_persists_empty_lists(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Empty values that were set before are not silently removed."""
    hass.config_entries.async_update_entry(
        mock_config_entry,
        options={"include_domains": ["zone"], "entities": ["person.home"]},
    )
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(
        mock_config_entry.entry_id
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            "title": "Open Map",
            "default_zoom": 14,
            "theme_mode": "auto",
            "cluster": True,
            "attribution": "",
            "entities": [],
            "geolocation_sources": "",
            "include_domains": [],
            "marker_color_default": "red",
            "marker_popup_title": "friendly_name",
            "marker_popup_body": "",
        },
    )
    await hass.async_block_till_done()

    assert result["type"] == FlowResultType.CREATE_ENTRY
    # Cleared values must actually be cleared in the saved options.
    assert mock_config_entry.options["include_domains"] == []
    assert mock_config_entry.options["entities"] == []


async def test_options_flow_preserves_blank_fields(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Blank/omitted fields must not wipe previously saved options.

    The frontend omits untouched password fields, and async_create_entry
    replaces the whole options dict; without merging, a submit that does
    not include the CARTO key would silently delete it.
    """
    hass.config_entries.async_update_entry(
        mock_config_entry,
        options={"carto_api_key": "keep-me", "include_domains": ["zone"]},
    )
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(
        mock_config_entry.entry_id
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            "title": "Open Map",
            "default_zoom": 14,
            "theme_mode": "auto",
            "cluster": True,
            "attribution": "",
            "entities": [],
            "include_domains": [],
            # carto_api_key deliberately omitted (blank password field)
            "marker_color_default": "default",
            "marker_popup_title": "friendly_name",
            "marker_popup_body": "",
        },
    )
    await hass.async_block_till_done()

    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert mock_config_entry.options["carto_api_key"] == "keep-me"


async def test_options_flow_clearing_key_removes_it(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """Explicitly emptying the key field clears the stored key."""
    hass.config_entries.async_update_entry(
        mock_config_entry, options={"carto_api_key": "existing-key"}
    )
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(
        mock_config_entry.entry_id
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            "title": "Open Map",
            "default_zoom": 14,
            "theme_mode": "auto",
            "cluster": True,
            "attribution": "",
            "entities": [],
            "include_domains": [],
            "carto_api_key": "",  # user emptied the field
            "marker_color_default": "default",
            "marker_popup_title": "friendly_name",
            "marker_popup_body": "",
        },
    )
    await hass.async_block_till_done()

    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert "carto_api_key" not in mock_config_entry.options


async def test_options_flow_marker_color_default_is_valid_choice(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """The untouched form must submit cleanly (regression: invalid default).

    The marker color select defaulted to "default" while only offering
    named colors, so submitting the untouched form failed schema
    validation and the dialog never closed.
    """
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(
        mock_config_entry.entry_id
    )
    # Submit exactly what the frontend sends for an untouched form.
    untouched = result["data_schema"]({})
    assert untouched["marker_color_default"] in [
        "default",
        "red",
        "orange",
        "green",
        "blue",
        "purple",
    ]

    result = await hass.config_entries.options.async_configure(
        result["flow_id"], user_input=untouched
    )
    await hass.async_block_till_done()
    assert result["type"] == FlowResultType.CREATE_ENTRY


async def test_options_flow_no_legacy_entry_arg(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """The options flow handler must not require a constructor argument."""
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(
        mock_config_entry.entry_id
    )
    assert result["type"] == FlowResultType.FORM

    # The flow runs end-to-end through the manager.
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            "title": "Still Open Map",
            "default_zoom": 14,
            "theme_mode": "auto",
            "cluster": True,
            "attribution": "",
            "entities": [],
            "include_domains": [],
            "marker_color_default": "red",
            "marker_popup_title": "friendly_name",
            "marker_popup_body": "",
        },
    )
    await hass.async_block_till_done()
    assert result["type"] == FlowResultType.CREATE_ENTRY
    assert mock_config_entry.options["title"] == "Still Open Map"
