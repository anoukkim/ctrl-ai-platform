"""feat-trip-country: CTRL+AI searches places for member apps, because the
free search cuts off an address that asks in bursts (a club shares wifi)."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.services import map_places


class Answer:
    def __init__(self, status: int = 200, body: object | None = None) -> None:
        self.status_code = status
        self._body = body if body is not None else {
            "features": [
                {"properties": {"name": "오죽헌", "osm_value": "attraction", "countrycode": "KR"}, "geometry": {"coordinates": [128.8778, 37.7786]}},
                {"properties": {"osm_value": "x", "countrycode": "KR"}, "geometry": {"coordinates": [1, 2]}},
            ]
        }

    def json(self):
        return self._body


class Recorder:
    def __init__(self, answer: Answer) -> None:
        self.answer = answer
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, url: str, **kwargs):
        self.calls.append((url, kwargs))
        return self.answer


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch) -> None:
    monkeypatch.setattr(map_places, "_gate", map_places._Gate())
    monkeypatch.setattr(map_places, "MIN_GAP_SECONDS", 0.0)


def settings_in(tmp_path: Path) -> Settings:
    return Settings(storage_dir=str(tmp_path / "storage"))


def test_the_route_answers_json_to_any_origin(anon_client: TestClient) -> None:
    response = anon_client.get("/_ctrlai/places", params={"q": "오죽헌", "lat": 37.75, "lon": 128.87})
    assert response.status_code == 200
    body = response.json()
    assert body["places"][0]["name"] == "오죽헌"
    assert abs(body["places"][0]["lat"] - 37.75) < 0.05
    assert response.headers["access-control-allow-origin"] == "*"
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize("params", [{}, {"q": ""}, {"q": "x" * 81}, {"q": "a", "lat": 91, "lon": 0}])
def test_bad_questions_are_refused(anon_client: TestClient, params: dict) -> None:
    assert anon_client.get("/_ctrlai/places", params=params).status_code == 422


def test_photon_is_asked_with_the_clubs_user_agent_and_only_named_places_come_back() -> None:
    get = Recorder(Answer())
    hits = map_places.PhotonPlaceProvider(get=get).search("오죽헌 강릉", 37.75, 128.87)
    assert hits == [{"name": "오죽헌", "lat": 37.7786, "lng": 128.8778, "kind": "attraction", "country": "KR"}]
    url, kwargs = get.calls[0]
    assert url == "https://photon.komoot.io/api/"
    assert kwargs["params"]["q"] == "오죽헌 강릉" and kwargs["params"]["lat"] == 37.75
    assert "CTRL+AI" in kwargs["headers"]["User-Agent"]
    assert kwargs["follow_redirects"] is False


@pytest.mark.parametrize("answer", [Answer(429, {}), Answer(200, {"features": [{"geometry": {}}]}), Answer(200, [])])
def test_a_refusal_or_an_odd_answer_is_an_error(answer: Answer) -> None:
    with pytest.raises(map_places.PlaceError):
        map_places.PhotonPlaceProvider(get=Recorder(answer)).search("x", None, None)


def test_the_server_selects_photon() -> None:
    assert isinstance(map_places.get_provider(Settings(place_search_provider="photon")), map_places.PhotonPlaceProvider)
    assert isinstance(map_places.get_provider(Settings(place_search_provider="mock")), map_places.MockPlaceProvider)
    assert Settings.model_fields["place_search_provider"].default == "mock"


def test_an_answer_is_kept_and_not_asked_again(tmp_path: Path) -> None:
    settings = settings_in(tmp_path)
    get = Recorder(Answer())
    provider = map_places.PhotonPlaceProvider(get=get)
    first = map_places.search(settings, "오죽헌  강릉", 37.751, 128.871, provider)
    second = map_places.search(settings, "오죽헌 강릉", 37.7512, 128.8711, provider)
    assert first == second and len(get.calls) == 1
    files = list(map_places.cache_dir(settings).rglob("*.json"))
    assert len(files) == 1 and json.loads(files[0].read_text(encoding="utf-8"))[0]["name"] == "오죽헌"
    old = time.time() - map_places.CACHE_SECONDS - 5
    os.utime(files[0], (old, old))
    map_places.search(settings, "오죽헌 강릉", 37.751, 128.871, provider)
    assert len(get.calls) == 2


def test_one_question_a_second_and_a_long_queue_is_refused(monkeypatch) -> None:
    monkeypatch.setattr(map_places, "MIN_GAP_SECONDS", 1.0)
    monkeypatch.setattr(map_places, "MAX_WAIT_SECONDS", 1.5)
    slept: list[float] = []
    monkeypatch.setattr(map_places.time, "sleep", lambda s: slept.append(s))
    gate = map_places._Gate()
    assert gate.wait_turn() and gate.wait_turn()
    assert slept[-1] > 0.9  # the second waited about a second
    # The clock did not move (sleep is stubbed): a third would start 2 s out,
    # past the 1.5 s a caller may wait — refused rather than queued.
    assert not gate.wait_turn()
