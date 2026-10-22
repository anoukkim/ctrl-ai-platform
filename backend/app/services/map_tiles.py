"""Map tiles for member apps (fix-app-map-tiles, 2026-10-22).

A member app runs in an opaque-origin frame, so its requests carry no
Referer — and OpenStreetMap's tile servers refuse such requests ("Access
blocked … tile usage policy"), as other free tile hosts do. So CTRL+AI
fetches the tiles itself and serves them on the apps origin at
`/_ctrlai/tiles/{z}/{x}/{y}.png`, the way OSM's policy asks of a proxy:
an identifying User-Agent and Referer, tiles kept for at least 7 days,
and no bulk downloading (`FETCHES_PER_MINUTE`). The attribution
("© OpenStreetMap") stays on the app's map.

Behind a provider like every outside service (CLAUDE.md §7):
`MAP_TILE_PROVIDER=mock` (default — a plain tile, no network) or `osm`.
Only `z/x/y` comes from the request; the host is fixed here, so this is
never an open proxy.
"""

from __future__ import annotations

import logging
import os
import struct
import threading
import time
import zlib
from pathlib import Path
from typing import Callable, Protocol

from app.core.config import Settings
from app.services.storage import storage_root

logger = logging.getLogger(__name__)

TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
MAX_ZOOM = 19
#: OSM asks that tiles are kept at least this long.
CACHE_SECONDS = 7 * 24 * 3600
#: Upstream fetches allowed per minute, per process; past it a tile that is
#: not cached answers 503 (the app shows its fallback). Cached tiles are
#: always served.
FETCHES_PER_MINUTE = 300
MAX_TILE_BYTES = 1_000_000
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
USER_AGENT = "CTRL+AI club member apps (https://ctrlai.my; ctrlai.platform@gmail.com)"


class TileError(Exception):
    """The tile could not be had (upstream refused, failed, or the budget ran out)."""


class TileProvider(Protocol):
    def fetch(self, z: int, x: int, y: int) -> bytes: ...


def _plain_png(size: int = 256, rgb: tuple[int, int, int] = (232, 236, 240)) -> bytes:
    """A one-colour PNG, made here so the mock needs no file."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    row = b"\x00" + bytes(rgb) * size
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return PNG_MAGIC + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(row * size)) + chunk(b"IEND", b"")


class MockTileProvider:
    """No network: the same plain tile everywhere."""

    _tile = _plain_png()

    def fetch(self, z: int, x: int, y: int) -> bytes:
        return self._tile


class OsmTileProvider:
    """tile.openstreetmap.org with the club's User-Agent and Referer.
    `get` is injectable so the checks are tested without the network."""

    def __init__(self, referer: str, get: Callable[..., object] | None = None) -> None:
        self.referer = referer
        self._get = get

    def fetch(self, z: int, x: int, y: int) -> bytes:
        import httpx2 as httpx

        get = self._get or httpx.get
        try:
            response = get(
                TILE_URL.format(z=z, x=x, y=y),
                headers={"User-Agent": USER_AGENT, "Referer": self.referer},
                timeout=10.0,
                follow_redirects=False,
            )
        except Exception as error:  # noqa: BLE001 — any transport failure
            raise TileError(type(error).__name__) from error
        status = getattr(response, "status_code", 0)
        content = getattr(response, "content", b"") or b""
        if status != 200:
            raise TileError(f"status {status}")
        if not content.startswith(PNG_MAGIC) or len(content) > MAX_TILE_BYTES:
            raise TileError("not a tile")
        return content


def get_provider(settings: Settings) -> TileProvider:
    if settings.provider_mode("map_tiles") == "osm":
        return OsmTileProvider(referer=settings.apps_origin.rstrip("/") + "/" if settings.apps_origin else "https://ctrlai.my/")
    return MockTileProvider()


def valid(z: int, x: int, y: int) -> bool:
    return 0 <= z <= MAX_ZOOM and 0 <= x < 2**z and 0 <= y < 2**z


def cache_dir(settings: Settings) -> Path:
    return storage_root(settings) / "map-tiles"


class _Budget:
    """At most `limit` upstream fetches in any minute."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._lock = threading.Lock()
        self._times: list[float] = []

    def take(self) -> bool:
        now = time.monotonic()
        with self._lock:
            self._times = [t for t in self._times if now - t < 60]
            if len(self._times) >= self.limit:
                return False
            self._times.append(now)
            return True


_budget = _Budget(FETCHES_PER_MINUTE)


def get_tile(settings: Settings, z: int, x: int, y: int, provider: TileProvider | None = None) -> bytes:
    """The tile, from the cache when fresh; a stale copy when upstream fails."""
    path = cache_dir(settings) / str(z) / str(x) / f"{y}.png"
    stale: bytes | None = None
    if path.is_file():
        data = path.read_bytes()
        if time.time() - path.stat().st_mtime < CACHE_SECONDS:
            return data
        stale = data
    if not _budget.take():
        if stale is not None:
            return stale
        raise TileError("budget")
    try:
        data = (provider or get_provider(settings)).fetch(z, x, y)
    except TileError as error:
        logger.warning("map tile %s/%s/%s: %s", z, x, y, error)
        if stale is not None:
            return stale
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)
    _prune_now_and_then(settings)
    return data


_writes = 0


def _prune_now_and_then(settings: Settings) -> None:
    """Every 200 writes: keep the cache under MAP_TILE_CACHE_MB, oldest out."""
    global _writes
    _writes += 1
    if _writes % 200:
        return
    prune(settings)


def prune(settings: Settings) -> int:
    limit = settings.map_tile_cache_mb * 1_000_000
    files = [(p.stat().st_mtime, p.stat().st_size, p) for p in cache_dir(settings).rglob("*.png")]
    total = sum(size for _, size, _ in files)
    removed = 0
    if total <= limit:
        return 0
    for _, size, path in sorted(files):
        if total <= limit * 0.9:
            break
        path.unlink(missing_ok=True)
        total -= size
        removed += 1
    return removed
