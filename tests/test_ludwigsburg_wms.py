"""Native-grid validation, bounded cache, HTTP auth, and shared fetch lifetimes."""

import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlparse

from PIL import Image
import pytest

from custom_components.openmap.http import LudwigsburgWmsView
from custom_components.openmap.ludwigsburg_wms import (
    LUDWIGSBURG_OVERLAY_PRESETS,
    NATIVE_EXTENT,
    NATIVE_RESOLUTIONS,
    build_upstream_url,
    native_tile_bbox,
)
from custom_components.openmap.tiles import TileBusyError, TileClient, TileError
from tests.test_http import _setup_client


def png(size=(256, 256)) -> bytes:
    buffer = BytesIO()
    Image.new("RGBA", size, (10, 20, 30, 100)).save(buffer, format="PNG")
    return buffer.getvalue()


def session_for(blob=None, status=200, gate=None, started=None):
    """Streaming mock retaining the production content-size checks."""
    if blob is None:
        blob = png()
    response = AsyncMock()
    response.status = status
    response.content_length = len(blob)

    async def parts(_size):
        if started:
            started.set()
        if gate:
            await gate.wait()
        yield blob[:30]
        yield blob[30:]

    response.content.iter_chunked = MagicMock(side_effect=parts)
    response.__aenter__.return_value = response
    session = MagicMock()
    session.get.return_value = response
    return session


def test_presets_and_grid() -> None:
    assert len(LUDWIGSBURG_OVERLAY_PRESETS) == 6
    assert len(NATIVE_RESOLUTIONS) == 10
    assert NATIVE_EXTENT == (490000, 5390000, 540000, 5440000)
    for preset in LUDWIGSBURG_OVERLAY_PRESETS.values():
        assert preset["connection"] and preset["layers"]


def test_native_grid_url() -> None:
    url = build_upstream_url(LUDWIGSBURG_OVERLAY_PRESETS["bus"], 5, 23, 23)
    args = parse_qs(urlparse(url).query)
    assert args["srs"] == ["EPSG:25832"]
    assert args["width"] == args["height"] == ["256"]
    bbox = tuple(map(float, args["bbox"][0].split(",")))
    assert bbox == native_tile_bbox(5, 23, 23)
    assert bbox[0] < 514073.7 < bbox[2]
    assert bbox[1] < 5415467.8 < bbox[3]
    assert bbox[2] - bbox[0] == bbox[3] - bbox[1] == 1024


@pytest.mark.parametrize(
    "coords", [(-1, 0, 0), (10, 0, 0), (1, -1, 0), (1, 0, -1), (0, 2, 0), (0, 0, 2)]
)
def test_outside_grid(coords) -> None:
    with pytest.raises(ValueError):
        native_tile_bbox(*coords)


async def test_auth_required(hass, aiohttp_client, socket_enabled) -> None:
    client = await _setup_client(hass, aiohttp_client, socket_enabled=socket_enabled)
    response = await client.get("/api/openmap/traffic/bus/5/23/23.png")
    assert response.status == 401


async def test_unloaded_service(
    hass, aiohttp_client, socket_enabled, hass_access_token
) -> None:
    client = await _setup_client(
        hass,
        aiohttp_client,
        socket_enabled=socket_enabled,
        hass_access_token=hass_access_token,
    )
    response = await client.get("/api/openmap/traffic/bus/5/23/23.png")
    assert response.status == 503


async def test_unknown_preset() -> None:
    response = await LudwigsburgWmsView().get(
        SimpleNamespace(app={}), "unknown", "5", "23", "23"
    )
    assert response.status == 404
    assert response.headers["Cache-Control"] == "no-store"


async def test_huge_coordinates_are_rejected_before_arithmetic() -> None:
    response = await LudwigsburgWmsView().get(
        SimpleNamespace(app={}), "bus", "5", "9" * 1000, "23"
    )
    assert response.status == 404


async def test_stream_and_cache() -> None:
    session = session_for()
    client = TileClient(session)
    first = await client.get(("bus", 5, 23, 23))
    second = await client.get(("bus", 5, 23, 23))
    assert first is second
    assert session.get.call_count == 1
    assert session.get.call_args.kwargs["allow_redirects"] is False
    assert first.content_type == "image/png"
    assert client.cache_bytes == len(first.body)
    await client.close()
    assert client.cache_bytes == 0 and not client.cache


async def test_initial_duplicates_share_fetch() -> None:
    gate, started = asyncio.Event(), asyncio.Event()
    session = session_for(gate=gate, started=started)
    client = TileClient(session)
    first = asyncio.create_task(client.get(("bus", 5, 23, 23)))
    await started.wait()
    second = asyncio.create_task(client.get(("bus", 5, 23, 23)))
    await asyncio.sleep(0)
    assert client.waiters == 2
    gate.set()
    a, b = await asyncio.gather(first, second)
    assert a is b and session.get.call_count == 1
    assert not client.tasks and not client.users
    await client.close()


async def test_cancelling_one_viewer_keeps_other_alive() -> None:
    gate, started = asyncio.Event(), asyncio.Event()
    client = TileClient(session_for(gate=gate, started=started))
    first = asyncio.create_task(client.get(("bus", 5, 23, 23)))
    await started.wait()
    second = asyncio.create_task(client.get(("bus", 5, 23, 23)))
    await asyncio.sleep(0)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    gate.set()
    assert (await second).content_type == "image/png"
    await client.close()


async def test_last_viewer_cancel_and_unload_cleanup() -> None:
    gate, started = asyncio.Event(), asyncio.Event()
    client = TileClient(session_for(gate=gate, started=started))
    first = asyncio.create_task(client.get(("bus", 5, 23, 23)))
    await started.wait()
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    await client.close()
    assert not client.tasks and not client.users and client.waiters == 0
    with pytest.raises(TileError, match="unloaded"):
        await client.get(("bus", 5, 23, 23))


async def test_pending_admission_is_bounded() -> None:
    gate, started = asyncio.Event(), asyncio.Event()
    client = TileClient(session_for(gate=gate, started=started))
    with patch("custom_components.openmap.tiles.MAX_INFLIGHT", 1):
        first = asyncio.create_task(client.get(("bus", 5, 23, 23)))
        await started.wait()
        with pytest.raises(TileBusyError):
            await client.get(("bus", 5, 24, 23))
        gate.set()
        await first
    await client.close()


@pytest.mark.parametrize(
    "blob,status",
    [(b"<html>bad</html>", 200), (png((1024, 1024)), 200), (png(), 302), (png(), 500)],
)
async def test_invalid_responses_not_cached(blob, status) -> None:
    client = TileClient(session_for(blob, status))
    with pytest.raises(TileError):
        await client.get(("bus", 5, 23, 23))
    assert not client.cache and not client.tasks
    await client.close()


async def test_size_bound_even_without_content_length() -> None:
    session = session_for(b"x" * 100)
    session.get.return_value.content_length = None
    client = TileClient(session)
    with (
        patch("custom_components.openmap.tiles.MAX_BODY_BYTES", 50),
        pytest.raises(TileError, match="size limit"),
    ):
        await client.get(("bus", 5, 23, 23))
    await client.close()


async def test_byte_budget_evicts_lru() -> None:
    client = TileClient(session_for())
    with patch("custom_components.openmap.tiles.MAX_CACHE_BYTES", len(png()) * 2):
        for x in (21, 22, 23):
            await client.get(("bus", 5, x, 23))
        assert list(client.cache) == [("bus", 5, 22, 23), ("bus", 5, 23, 23)]
    await client.close()
