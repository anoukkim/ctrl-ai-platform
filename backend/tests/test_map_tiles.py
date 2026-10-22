"""fix-app-map-tiles: CTRL+AI serves OpenStreetMap's tiles to member apps,
because an app's opaque-origin frame sends no Referer and OSM refuses it."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.services import map_tiles


def settings_in(tmp_path: Path, **extra) -> Settings:
    return Settings(storage_dir=str(tmp_path / "storage"), **extra)


class Answer:
    def __init__(self, status: int = 200, content: bytes = map_tiles.MockTileProvider._tile) -> None:
        self.status_code = status
        self.content = content


class Recorder:
    def __init__(self, answer: Answer) -> None:
        self.answer = answer
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, url: str, **kwargs):
        self.calls.append((url, kwargs))
        return self.answer


@pytest.fixture(autouse=True)
def fresh_budget(monkeypatch) -> None:
    monkeypatch.setattr(map_tiles, "_budget", map_tiles._Budget(map_tiles.FETCHES_PER_MINUTE))


def test_the_route_serves_a_png_to_any_origin(anon_client: TestClient) -> None:
    response = anon_client.get("/_ctrlai/tiles/3/4/2.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(map_tiles.PNG_MAGIC)
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize("path", ["/_ctrlai/tiles/20/0/0.png", "/_ctrlai/tiles/2/4/0.png", "/_ctrlai/tiles/2/0/-1.png"])
def test_tiles_outside_the_world_are_404(anon_client: TestClient, path: str) -> None:
    assert anon_client.get(path).status_code == 404


def test_only_numbers_reach_the_service(anon_client: TestClient) -> None:
    for path in ("/_ctrlai/tiles/1/0/x.png", "/_ctrlai/tiles/1/0/0.jpg", "/_ctrlai/tiles/1/0/..%2F0.png"):
        assert anon_client.get(path).status_code in (404, 422), path
    assert anon_client.get("/api/_ctrlai/tiles/1/0/0.png").status_code == 404


def test_osm_is_asked_with_the_clubs_user_agent_and_referer() -> None:
    get = Recorder(Answer())
    tile = map_tiles.OsmTileProvider(referer="https://apps.ctrlai.my/", get=get).fetch(5, 27, 12)
    assert tile.startswith(map_tiles.PNG_MAGIC)
    url, kwargs = get.calls[0]
    assert url == "https://tile.openstreetmap.org/5/27/12.png"
    assert "CTRL+AI" in kwargs["headers"]["User-Agent"]
    assert kwargs["headers"]["Referer"] == "https://apps.ctrlai.my/"
    assert kwargs["follow_redirects"] is False


@pytest.mark.parametrize("answer", [Answer(403, b"blocked"), Answer(200, b"<html>blocked</html>"), Answer(302, b"")])
def test_a_refusal_or_non_png_is_an_error(answer: Answer) -> None:
    with pytest.raises(map_tiles.TileError):
        map_tiles.OsmTileProvider(referer="x", get=Recorder(answer)).fetch(1, 0, 0)


def test_the_server_selects_osm_and_its_referer() -> None:
    real = map_tiles.get_provider(Settings(map_tile_provider="osm", apps_base_url="https://apps.ctrlai.my"))
    assert isinstance(real, map_tiles.OsmTileProvider) and real.referer == "https://apps.ctrlai.my/"
    assert isinstance(map_tiles.get_provider(Settings(map_tile_provider="mock")), map_tiles.MockTileProvider)
    assert Settings.model_fields["map_tile_provider"].default == "mock"


def test_a_cached_tile_is_not_fetched_again(tmp_path: Path) -> None:
    settings = settings_in(tmp_path)
    get = Recorder(Answer())
    provider = map_tiles.OsmTileProvider(referer="x", get=get)
    first = map_tiles.get_tile(settings, 4, 3, 2, provider)
    second = map_tiles.get_tile(settings, 4, 3, 2, provider)
    assert first == second and len(get.calls) == 1
    assert (map_tiles.cache_dir(settings) / "4" / "3" / "2.png").is_file()


def test_a_stale_tile_is_refetched_and_kept_when_upstream_fails(tmp_path: Path) -> None:
    settings = settings_in(tmp_path)
    map_tiles.get_tile(settings, 4, 3, 2, map_tiles.MockTileProvider())
    path = map_tiles.cache_dir(settings) / "4" / "3" / "2.png"
    old = time.time() - map_tiles.CACHE_SECONDS - 10
    os.utime(path, (old, old))
    failing = map_tiles.OsmTileProvider(referer="x", get=Recorder(Answer(503, b"")))
    assert map_tiles.get_tile(settings, 4, 3, 2, failing).startswith(map_tiles.PNG_MAGIC)
    with pytest.raises(map_tiles.TileError):
        map_tiles.get_tile(settings, 4, 3, 3, failing)


def test_upstream_fetches_have_a_budget(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(map_tiles, "_budget", map_tiles._Budget(2))
    settings = settings_in(tmp_path)
    provider = map_tiles.MockTileProvider()
    map_tiles.get_tile(settings, 3, 0, 0, provider)
    map_tiles.get_tile(settings, 3, 0, 1, provider)
    with pytest.raises(map_tiles.TileError):
        map_tiles.get_tile(settings, 3, 0, 2, provider)
    # Cached tiles are still served.
    assert map_tiles.get_tile(settings, 3, 0, 0, provider)


def test_prune_keeps_the_cache_under_its_cap(tmp_path: Path) -> None:
    settings = settings_in(tmp_path, map_tile_cache_mb=1)
    folder = map_tiles.cache_dir(settings) / "9" / "1"
    folder.mkdir(parents=True)
    for y in range(6):
        path = folder / f"{y}.png"
        path.write_bytes(b"x" * 300_000)
        os.utime(path, (1000 + y, 1000 + y))
    assert map_tiles.prune(settings) >= 3
    left = sorted(p.name for p in folder.iterdir())
    assert "5.png" in left and "0.png" not in left
    assert sum(p.stat().st_size for p in folder.iterdir()) <= 1_000_000
