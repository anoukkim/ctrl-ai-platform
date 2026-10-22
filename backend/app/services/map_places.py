"""Place search for member apps (feat-trip-country, 2026-10-22).

"강릉 오죽헌" → a name and a position. The free search (Photon, built on
OpenStreetMap) refuses a visitor's address outright after a burst of
questions — seen while building this: a dozen quick searches from one
computer and its address was cut off. A club shares wifi, so CTRL+AI asks
for the apps instead, at `/_ctrlai/places?q=…&lat=…&lon=…` on the apps
origin: one question a second at most (`MIN_GAP_SECONDS`, per process),
an identifying User-Agent, and every answer kept 30 days so the same
search is never asked twice.

Behind a provider like every outside service (CLAUDE.md §7):
`PLACE_SEARCH_PROVIDER=mock` (default — invented places near the given
position, no network) or `photon`. Only the query text and an optional
position come from the request; the host is fixed here.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Callable, Protocol

from app.core.config import Settings
from app.services.storage import storage_root

logger = logging.getLogger(__name__)

SEARCH_URL = "https://photon.komoot.io/api/"
USER_AGENT = "CTRL+AI club member apps (https://ctrlai.my; ctrlai.platform@gmail.com)"
CACHE_SECONDS = 30 * 24 * 3600
#: At most one upstream question per this many seconds, per process.
MIN_GAP_SECONDS = 1.0
#: A caller waits at most this long for its turn, then gets 503.
MAX_WAIT_SECONDS = 20.0
MAX_QUERY = 80
MAX_RESULTS = 5


class PlaceError(Exception):
    """The search could not be had (upstream refused or failed, or too busy)."""


class PlaceProvider(Protocol):
    def search(self, query: str, lat: float | None, lon: float | None) -> list[dict]: ...


def _hit(name: str, lat: float, lng: float, kind: str, country: str) -> dict:
    return {"name": name, "lat": round(lat, 6), "lng": round(lng, 6), "kind": kind, "country": country}


class MockPlaceProvider:
    """No network: one invented place a little way from the given position."""

    def search(self, query: str, lat: float | None, lon: float | None) -> list[dict]:
        digest = hashlib.sha256(query.encode()).digest()
        base_lat, base_lon = (lat, lon) if lat is not None and lon is not None else (37.5665, 126.978)
        return [_hit(query, base_lat + (digest[0] - 128) / 4000, base_lon + (digest[1] - 128) / 4000, "mock", "KR")]


class PhotonPlaceProvider:
    """photon.komoot.io with the club's User-Agent. `get` is injectable for tests."""

    def __init__(self, get: Callable[..., object] | None = None) -> None:
        self._get = get

    def search(self, query: str, lat: float | None, lon: float | None) -> list[dict]:
        import httpx2 as httpx

        params: dict[str, object] = {"q": query, "limit": MAX_RESULTS}
        if lat is not None and lon is not None:
            params.update(lat=lat, lon=lon)
        try:
            response = (self._get or httpx.get)(
                SEARCH_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=10.0, follow_redirects=False
            )
        except Exception as error:  # noqa: BLE001 — any transport failure
            raise PlaceError(type(error).__name__) from error
        if getattr(response, "status_code", 0) != 200:
            raise PlaceError(f"status {getattr(response, 'status_code', 0)}")
        try:
            features = response.json().get("features", [])
            hits = []
            for feature in features[:MAX_RESULTS]:
                props = feature.get("properties", {})
                lon_, lat_ = feature["geometry"]["coordinates"][:2]
                name = str(props.get("name") or "")[:80]
                if name:
                    hits.append(_hit(name, float(lat_), float(lon_), str(props.get("osm_value") or "")[:30], str(props.get("countrycode") or "")[:2]))
            return hits
        except (AttributeError, KeyError, TypeError, ValueError) as error:
            raise PlaceError("unreadable") from error


def get_provider(settings: Settings) -> PlaceProvider:
    if settings.provider_mode("place_search") == "photon":
        return PhotonPlaceProvider()
    return MockPlaceProvider()


def cache_dir(settings: Settings) -> Path:
    return storage_root(settings) / "map-places"


def _cache_path(settings: Settings, query: str, lat: float | None, lon: float | None) -> Path:
    near = "" if lat is None or lon is None else f"{lat:.2f},{lon:.2f}"
    key = hashlib.sha256(f"{query}\n{near}".encode()).hexdigest()
    return cache_dir(settings) / key[:2] / f"{key}.json"


class _Gate:
    """One upstream question per MIN_GAP_SECONDS; a caller waits its turn."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._next = 0.0

    def wait_turn(self) -> bool:
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next)
            if start - now > MAX_WAIT_SECONDS:
                return False
            self._next = start + MIN_GAP_SECONDS
        time.sleep(max(0.0, start - now))
        return True


_gate = _Gate()


def search(
    settings: Settings, query: str, lat: float | None = None, lon: float | None = None, provider: PlaceProvider | None = None
) -> list[dict]:
    """Up to five places for `query`, nearest `lat/lon` first; cached 30 days."""
    query = " ".join(query.split())[:MAX_QUERY]
    path = _cache_path(settings, query, lat, lon)
    if path.is_file() and time.time() - path.stat().st_mtime < CACHE_SECONDS:
        return json.loads(path.read_text(encoding="utf-8"))
    if not _gate.wait_turn():
        raise PlaceError("busy")
    try:
        hits = (provider or get_provider(settings)).search(query, lat, lon)
    except PlaceError as error:
        logger.warning("place search %r: %s", query, error)
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(hits, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)
    return hits
