"""Test the CARTO API key HTTP view."""

from __future__ import annotations

from unittest.mock import patch

from homeassistant.components.http import KEY_HASS
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.openmap.const import DOMAIN
from custom_components.openmap.http import CartoApiKeyView, async_register_http_views

ENDPOINT = "/api/openmap/basemap_key"


async def _setup_client(
    hass: HomeAssistant,
    aiohttp_client,
    entry=None,
    socket_enabled=None,
    hass_access_token=None,
):
    """Register the view on the test HTTP app and return a client."""
    from homeassistant.components.http.auth import async_setup_auth

    async_register_http_views(hass)
    hass.http.app[KEY_HASS] = hass
    hass.http.app["hass"] = hass
    await async_setup_auth(hass, hass.http.app)
    if entry is not None:
        entry.add_to_hass(hass)
    headers = (
        {"Authorization": f"Bearer {hass_access_token}"} if hass_access_token else {}
    )
    return await aiohttp_client(hass.http.app, headers=headers)


async def test_key_endpoint_returns_key(
    hass: HomeAssistant, aiohttp_client, socket_enabled, hass_access_token
) -> None:
    """The endpoint returns the key from entry options."""
    entry = MockConfigEntry(domain=DOMAIN, options={"carto_api_key": "sekrit123"})
    client = await _setup_client(
        hass, aiohttp_client, entry, hass_access_token=hass_access_token
    )

    resp = await client.get(ENDPOINT)
    assert resp.status == 200
    assert await resp.json() == {"carto_api_key": "sekrit123"}


async def test_key_endpoint_404_without_key(
    hass: HomeAssistant, aiohttp_client, socket_enabled, hass_access_token
) -> None:
    """Without a configured key the endpoint answers 404."""
    entry = MockConfigEntry(domain=DOMAIN, options={})
    client = await _setup_client(
        hass, aiohttp_client, entry, hass_access_token=hass_access_token
    )

    resp = await client.get(ENDPOINT)
    assert resp.status == 404


async def test_key_endpoint_404_without_entries(
    hass: HomeAssistant, aiohttp_client, socket_enabled, hass_access_token
) -> None:
    """With no config entries at all the endpoint answers 404."""
    client = await _setup_client(
        hass,
        aiohttp_client,
        socket_enabled=socket_enabled,
        hass_access_token=hass_access_token,
    )

    resp = await client.get(ENDPOINT)
    assert resp.status == 404


async def test_key_endpoint_prefers_options_over_data(
    hass: HomeAssistant, aiohttp_client, socket_enabled, hass_access_token
) -> None:
    """Options take precedence over data."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"carto_api_key": "old"},
        options={"carto_api_key": "new"},
    )
    client = await _setup_client(
        hass, aiohttp_client, entry, hass_access_token=hass_access_token
    )

    resp = await client.get(ENDPOINT)
    assert resp.status == 200
    assert await resp.json() == {"carto_api_key": "new"}


async def test_view_url_and_auth_attributes() -> None:
    """The view is authenticated and registered at the documented URL."""
    view = CartoApiKeyView()
    assert view.url == ENDPOINT
    assert view.requires_auth is True


async def test_panel_receives_key_via_options(
    hass: HomeAssistant, mock_config_entry
) -> None:
    """The configured key propagates into the sidebar panel config."""
    from custom_components.openmap import PANEL_URL_PATH, _panel_config_from_entry

    hass.config_entries.async_update_entry(
        mock_config_entry,
        options={"carto_api_key": "panelkey"},
    )
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    panel = hass.data["frontend_panels"][PANEL_URL_PATH]
    assert panel.config["carto_api_key"] == "panelkey"
    assert _panel_config_from_entry(mock_config_entry)["carto_api_key"] == "panelkey"

    # Sanity: static path registration stays mocked in this environment.
    with patch.object(
        type(hass.http), "async_register_static_paths"
    ) as spy:
        assert await hass.config_entries.async_reload(mock_config_entry.entry_id)
        await hass.async_block_till_done()
        assert panel.config["carto_api_key"] == "panelkey"
        spy.assert_not_called()
