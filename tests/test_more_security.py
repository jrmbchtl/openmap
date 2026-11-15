"""Retry and clearing regression tests around entry-owned tile resources."""

import asyncio
from unittest.mock import patch

from homeassistant.core import HomeAssistant
import pytest

from custom_components.openmap.tiles import TileClient
from tests.test_http import _setup_client
from tests.test_ludwigsburg_wms import session_for


async def test_last_waiter_immediate_retry() -> None:
    gate, started = asyncio.Event(), asyncio.Event()
    client = TileClient(session_for(gate=gate, started=started))
    first = asyncio.create_task(client.get(("bus", 5, 23, 23)))
    await started.wait()
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    second = asyncio.create_task(client.get(("bus", 5, 23, 23)))
    gate.set()
    assert (await second).content_type == "image/png"
    assert not client.tasks and not client.users
    await client.close()


async def test_setup_failure_closes_runtime(
    hass: HomeAssistant, mock_config_entry
) -> None:
    with patch(
        "custom_components.openmap._async_register_static_path",
        side_effect=ValueError("failed"),
    ):
        assert not await hass.config_entries.async_setup(mock_config_entry.entry_id)
    assert mock_config_entry.runtime_data.tiles.closed


async def test_cleared_options_key_does_not_fall_back_to_data(
    hass, mock_config_entry, aiohttp_client, socket_enabled, hass_access_token
) -> None:
    hass.config_entries.async_update_entry(
        mock_config_entry, data={"carto_api_key": "old"}, options={"carto_api_key": ""}
    )
    client = await _setup_client(
        hass,
        aiohttp_client,
        socket_enabled=socket_enabled,
        hass_access_token=hass_access_token,
    )
    response = await client.get("/api/openmap/basemap_key")
    assert response.status == 404
    assert response.headers["Cache-Control"] == "no-store"
