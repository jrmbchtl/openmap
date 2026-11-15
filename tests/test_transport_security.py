"""Exercise authenticated transport responses without contacting the provider."""

from unittest.mock import patch

import pytest

from tests.test_http import _setup_client
from tests.test_ludwigsburg_wms import session_for


async def test_loaded_transport_headers_and_removed_legacy_route(
    hass, mock_config_entry, aiohttp_client, socket_enabled, hass_access_token
) -> None:
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    mock_config_entry.runtime_data.tiles.session = session_for()
    client = await _setup_client(
        hass, aiohttp_client, hass_access_token=hass_access_token
    )
    response = await client.get("/api/openmap/traffic/bus/5/23/23.png")
    assert response.status == 200
    assert response.content_type == "image/png"
    assert response.headers["Cache-Control"].startswith("private, max-age=")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert int(response.headers["X-OpenMap-Fetched-At"]) > 0
    assert (await response.read()).startswith(b"\x89PNG")
    legacy = await client.get("/api/openmap/ludwigsburg_wms/bus/5/23/23.png")
    assert legacy.status == 404


@pytest.mark.parametrize("busy,expected", [(True, 429), (False, 502)])
async def test_errors_are_not_cached_and_busy_is_actionable(
    hass,
    mock_config_entry,
    aiohttp_client,
    socket_enabled,
    hass_access_token,
    busy,
    expected,
) -> None:
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    mock_config_entry.runtime_data.tiles.session = session_for(status=503)
    client = await _setup_client(
        hass, aiohttp_client, hass_access_token=hass_access_token
    )
    with patch("custom_components.openmap.tiles.MAX_WAITERS", 0 if busy else 32):
        response = await client.get("/api/openmap/traffic/bus/5/23/23.png")
    assert response.status == expected
    assert response.headers["Cache-Control"] == "no-store"
    if busy:
        assert response.headers["Retry-After"] == "2"
    assert "logis2" not in await response.text()


async def test_key_endpoint_requires_real_ha_auth(hass, aiohttp_client, socket_enabled):
    client = await _setup_client(hass, aiohttp_client)
    assert (await client.get("/api/openmap/basemap_key")).status == 401
