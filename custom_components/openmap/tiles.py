"""Bounded, cancellation-safe native image transport. No server-side GIS."""

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
import struct
import time

import aiohttp

from .ludwigsburg_wms import (
    LUDWIGSBURG_OVERLAY_PRESETS,
    UPSTREAM_REFERER,
    build_upstream_url,
)

MAX_BODY_BYTES = 1024 * 1024
MAX_CACHE_BYTES = 16 * 1024 * 1024
MAX_CACHE_ENTRIES = 128
MAX_INFLIGHT = 12
MAX_WAITERS = 32
MAX_FETCHES = 4
CACHE_TTL = 1800
type TileKey = tuple[str, int, int, int]


class TileError(Exception):
    """A safe public error, without upstream URL/response details."""


class TileBusyError(TileError):
    """Admission limit reached."""


@dataclass(frozen=True)
class Tile:
    """Validated image and cache timestamps."""

    body: bytes
    content_type: str
    expires: float
    fetched_at: float


def image_type(body: bytes) -> tuple[str, bool]:
    """Reject non-images and oversized dimensions before browser decoding."""
    if body.startswith(b"\x89PNG\r\n\x1a\n") and len(body) >= 33:
        if body[12:16] != b"IHDR":
            raise TileError("Invalid traffic image")
        width, height = struct.unpack(">II", body[16:24])
        if (width, height) not in ((256, 256), (1, 1)):
            raise TileError("Invalid traffic image dimensions")
        return "image/png", width == 1
    if (
        body.startswith((b"GIF87a", b"GIF89a"))
        and len(body) >= 13
        and struct.unpack("<HH", body[6:10]) == (1, 1)
    ):
        return "image/gif", True
    raise TileError("Invalid traffic image")


class TileClient:
    """One integration-owned cache and finite set of shared fetch tasks."""

    def __init__(self, session: aiohttp.ClientSession) -> None:
        self.session = session
        self.cache: OrderedDict[TileKey, Tile] = OrderedDict()
        self.cache_bytes = 0
        self.tasks: dict[TileKey, asyncio.Task[Tile]] = {}
        self.users: dict[TileKey, int] = {}
        self.waiters = 0
        self.semaphore = asyncio.Semaphore(MAX_FETCHES)
        self.closed = False

    async def get(self, key: TileKey) -> Tile:
        """Join a shared fetch; cancellation of one viewer cannot hang others."""
        if self.closed:
            raise TileError("Open Map is unloaded")
        cached = self.cache.get(key)
        if cached and cached.expires > time.monotonic():
            self.cache.move_to_end(key)
            return cached
        if cached:
            self.cache_bytes -= len(self.cache.pop(key).body)
        if self.waiters >= MAX_WAITERS:
            raise TileBusyError("Traffic service is busy")
        task = self.tasks.get(key)
        if task is None:
            if len(self.tasks) >= MAX_INFLIGHT:
                raise TileBusyError("Traffic service is busy")
            task = asyncio.create_task(self._load(key), name="openmap traffic tile")
            # Retrieve exceptions even if every HTTP caller disconnects.
            task.add_done_callback(
                lambda done: None if done.cancelled() else done.exception()
            )
            self.tasks[key] = task
        self.users[key] = self.users.get(key, 0) + 1
        self.waiters += 1
        try:
            return await asyncio.shield(task)
        finally:
            self.waiters -= 1
            self.users[key] -= 1
            if self.users[key] == 0:
                self.users.pop(key)
                if not task.done():
                    task.cancel()
                # Detach only after the last waiter leaves. An immediate retry
                # must not join a task whose cancellation has already started.
                if self.tasks.get(key) is task:
                    self.tasks.pop(key)

    async def _load(self, key: TileKey) -> Tile:
        try:
            async with asyncio.timeout(15), self.semaphore:
                preset, z, x, y = key
                url = build_upstream_url(LUDWIGSBURG_OVERLAY_PRESETS[preset], z, x, y)
                async with self.session.get(
                    url,
                    allow_redirects=False,
                    timeout=aiohttp.ClientTimeout(total=10),
                    headers={"Referer": UPSTREAM_REFERER},
                ) as response:
                    if response.status != 200:
                        raise TileError("Traffic provider is unavailable")
                    if (
                        response.content_length
                        and response.content_length > MAX_BODY_BYTES
                    ):
                        raise TileError("Traffic image exceeds size limit")
                    body = bytearray()
                    async for part in response.content.iter_chunked(16384):
                        if len(body) + len(part) > MAX_BODY_BYTES:
                            raise TileError("Traffic image exceeds size limit")
                        body.extend(part)
                blob = bytes(body)
                content_type, blank = image_type(blob)
                tile = Tile(
                    blob,
                    content_type,
                    time.monotonic() + (60 if blank else CACHE_TTL),
                    time.time(),
                )
                self._cache(key, tile)
                return tile
        except (aiohttp.ClientError, TimeoutError) as err:
            raise TileError("Traffic provider did not respond") from err

    def _cache(self, key: TileKey, tile: Tile) -> None:
        if self.closed:
            return
        if previous := self.cache.pop(key, None):
            self.cache_bytes -= len(previous.body)
        self.cache[key] = tile
        self.cache_bytes += len(tile.body)
        while len(self.cache) > MAX_CACHE_ENTRIES or self.cache_bytes > MAX_CACHE_BYTES:
            _, oldest = self.cache.popitem(last=False)
            self.cache_bytes -= len(oldest.body)

    async def close(self) -> None:
        """Cancel and await outstanding work; release all cached images."""
        self.closed = True
        pending = list(self.tasks.values())
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        self.tasks.clear()
        self.cache.clear()
        self.cache_bytes = 0
