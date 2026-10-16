"""ui-improvements — 고정 (Builder, Video), 즐겨찾기 (CtrlAIApps).

A pin is the owner's own flag with a timestamp, so the list can put pinned
work first and still order by date inside each group; a favourite is a
per-member row on a published app — a reading preference, never shown to
the maker, gone from the list with the app.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import AppFavorite, BuilderProject, VideoProject
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD

APPS_BASE = "http://apps.test"


@pytest.fixture
def config(tmp_path):
    settings = Settings(
        app_env="development",
        chat_mock_delay_ms=0,
        apps_dir=str(tmp_path / "apps"),
        apps_base_url=APPS_BASE,
        storage_dir=str(tmp_path / "storage"),
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


# ------------------------------------------------------------ 고정


def test_a_builder_project_is_pinned_with_a_timestamp_and_unpinned_again(
    client: TestClient, db_session: Session, dev_user, participating
) -> None:
    project = BuilderProject(owner_user_id=dev_user.id, name="가계부", description="")
    db_session.add(project)
    db_session.commit()

    before = client.get(f"/api/builder/projects/{project.id}").json()
    assert before["pinned_at"] is None

    pinned = client.post(f"/api/builder/projects/{project.id}/pin", json={"on": True})
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned_at"] is not None
    # A pin is not an edit: 마지막 수정 (updated_at) stays where it was.
    assert pinned.json()["updated_at"] == before["updated_at"]
    # Other fields are untouched, and a PATCH leaves the pin.
    assert pinned.json()["name"] == "가계부"
    renamed = client.patch(f"/api/builder/projects/{project.id}", json={"name": "새 가계부"}).json()
    assert renamed["pinned_at"] == pinned.json()["pinned_at"]
    [row] = client.get("/api/builder/projects").json()
    assert row["pinned_at"] == pinned.json()["pinned_at"]
    # `pinned` is not a PATCH field any more.
    assert "pinned_at" in client.patch(f"/api/builder/projects/{project.id}", json={"pinned": False}).json()
    assert client.get(f"/api/builder/projects/{project.id}").json()["pinned_at"] == pinned.json()["pinned_at"]

    unpinned = client.post(f"/api/builder/projects/{project.id}/pin", json={"on": False}).json()
    assert unpinned["pinned_at"] is None
    assert unpinned["updated_at"] == renamed["updated_at"]
    # The JSON-body rule holds for the pin too.
    assert client.post(f"/api/builder/projects/{project.id}/pin", content="true", headers={"Content-Type": "text/plain"}).status_code in (415, 422)


def test_a_pin_is_a_reading_preference_open_to_an_owner_not_taking_part(
    client: TestClient, db_session: Session, dev_user
) -> None:
    """No `participating` fixture: dev sits this quarter out. Like ★ on
    CtrlAIApps (and unlike a rename), pinning their own list still works."""
    project = BuilderProject(owner_user_id=dev_user.id, name="가계부", description="")
    db_session.add(project)
    db_session.commit()
    assert client.patch(f"/api/builder/projects/{project.id}", json={"name": "x"}).status_code == 403
    pinned = client.post(f"/api/builder/projects/{project.id}/pin", json={"on": True})
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned_at"] is not None


def test_a_video_project_is_pinned_the_same_way(
    client: TestClient, db_session: Session, dev_user, participating
) -> None:
    """No `video_open` either: the pin route is a read preference, not a
    Video write — the locked screen hides it from members anyway."""
    project = VideoProject(owner_user_id=dev_user.id, name="비 오는 서울", prompt="")
    db_session.add(project)
    db_session.commit()

    before = client.get(f"/api/video/projects/{project.id}").json()
    pinned = client.post(f"/api/video/projects/{project.id}/pin", json={"on": True})
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned_at"] is not None
    assert pinned.json()["updated_at"] == before["updated_at"]
    [row] = client.get("/api/video/projects").json()
    assert row["pinned_at"] == pinned.json()["pinned_at"]
    assert client.post(f"/api/video/projects/{project.id}/pin", json={"on": False}).json()["pinned_at"] is None


# ------------------------------------------------------------ 즐겨찾기


def _published(client: TestClient, db_session: Session, owner) -> BuilderProject:
    project = BuilderProject(owner_user_id=owner.id, name="할 일", description="")
    db_session.add(project)
    db_session.commit()
    generated = client.post(
        f"/api/builder/projects/{project.id}/generate", json={"request": "할 일 앱을 만들어 줘", "style": ""}
    )
    assert generated.status_code == 200, generated.text
    published = client.post(
        f"/api/builder/projects/{project.id}/publish", json={"description": "할 일 앱이에요.", "note": ""}
    )
    assert published.status_code == 200, published.text
    db_session.refresh(project)
    return project


def _sign_in(client: TestClient, username: str, password: str) -> None:
    """`client` and `other_client` share one cookie jar: switch by hand."""
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"username": username, "password": password}).status_code == 200


def test_a_favourite_is_per_member_and_idempotent(
    client: TestClient, db_session: Session, dev_user, other_user, budgeted, config
) -> None:
    project = _published(client, db_session, dev_user)
    slug = project.app_slug
    assert client.get("/api/apps").json()[0]["favorite"] is False

    # The other member — not participating: a favourite is reading, not creating.
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    assert client.get("/api/apps").json()[0]["favorite"] is False
    on = client.post(f"/api/apps/{slug}/favorite", json={"on": True})
    assert on.status_code == 200, on.text
    assert on.json()["favorite"] is True
    assert client.get(f"/api/apps/{slug}").json()["favorite"] is True
    assert client.get("/api/apps").json()[0]["favorite"] is True

    # Setting it again adds no second row; off removes the one row; off again is fine.
    client.post(f"/api/apps/{slug}/favorite", json={"on": True})
    assert db_session.query(AppFavorite).filter_by(user_id=other_user.id).count() == 1
    assert client.post(f"/api/apps/{slug}/favorite", json={"on": False}).json()["favorite"] is False
    assert db_session.query(AppFavorite).filter_by(user_id=other_user.id).count() == 0
    assert client.post(f"/api/apps/{slug}/favorite", json={"on": False}).status_code == 200
    client.post(f"/api/apps/{slug}/favorite", json={"on": True})

    # The maker's own listings never show another member's favourite.
    _sign_in(client, dev_user.username, DEV_PASSWORD)
    assert client.get("/api/apps").json()[0]["favorite"] is False
    assert client.get("/api/apps/mine").json()[0]["favorite"] is False


def test_a_favourite_needs_a_listed_app_and_a_json_body(
    client: TestClient, db_session: Session, dev_user, other_user, budgeted, config
) -> None:
    project = _published(client, db_session, dev_user)
    slug = project.app_slug

    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    assert client.post("/api/apps/nope123456/favorite", json={"on": True}).status_code == 404
    assert client.post(f"/api/apps/{slug}/favorite", content="on", headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.post(f"/api/apps/{slug}/favorite", json={"on": True}).status_code == 200

    # The favourite goes with the app: once it is taken down, the slug is a 404 for everyone.
    _sign_in(client, dev_user.username, DEV_PASSWORD)
    assert client.post(f"/api/builder/projects/{project.id}/unpublish", json={}).status_code == 200
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    assert client.get("/api/apps").json() == []
    assert client.post(f"/api/apps/{slug}/favorite", json={"on": True}).status_code == 404
