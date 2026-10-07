"""The two libraries' filters (전체 / Draft / 게시됨), the removed archived
status, and the video card's thumbnail — final UI pass, 2026-10-07."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    BuilderProject,
    BuilderProjectStatus,
    User,
    VideoProject,
    VideoProjectStatus,
)


@pytest.fixture
def config(tmp_path):
    settings = Settings(storage_dir=str(tmp_path), app_env="development")
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def names(response) -> set[str]:
    assert response.status_code == 200, response.text
    return {project["name"] for project in response.json()}


# ------------------------------------------------------------- filters


def test_builder_filters_group_every_unpublished_state_under_draft(
    client: TestClient, db_session: Session, dev_user: User
) -> None:
    for name, status in [
        ("d", BuilderProjectStatus.DRAFT),
        ("b", BuilderProjectStatus.BUILDING),
        ("r", BuilderProjectStatus.READY),
        ("p", BuilderProjectStatus.PUBLISHED),
    ]:
        db_session.add(BuilderProject(owner_user_id=dev_user.id, name=name, status=status))
    db_session.commit()

    assert names(client.get("/api/builder/projects")) == {"d", "b", "r", "p"}
    assert names(client.get("/api/builder/projects?status=all")) == {"d", "b", "r", "p"}
    assert names(client.get("/api/builder/projects?status=draft")) == {"d", "b", "r"}
    assert names(client.get("/api/builder/projects?status=published")) == {"p"}


def test_video_filters_group_every_unpublished_state_under_draft(
    client: TestClient, db_session: Session, dev_user: User
) -> None:
    for name, status in [
        ("d", VideoProjectStatus.DRAFT),
        ("g", VideoProjectStatus.GENERATING),
        ("r", VideoProjectStatus.READY),
        ("p", VideoProjectStatus.PUBLISHED),
    ]:
        db_session.add(VideoProject(owner_user_id=dev_user.id, name=name, status=status))
    db_session.commit()

    assert names(client.get("/api/video/projects?status=draft")) == {"d", "g", "r"}
    assert names(client.get("/api/video/projects?status=published")) == {"p"}


@pytest.mark.parametrize("path", ["/api/builder/projects", "/api/video/projects"])
def test_an_unknown_filter_is_refused(client: TestClient, path: str) -> None:
    assert client.get(f"{path}?status=archived").status_code == 422


# ------------------------------------------------------------- archived is gone


def test_archived_is_no_longer_a_status(client: TestClient, participating) -> None:
    project = client.post("/api/builder/projects", json={"name": "p"}).json()
    response = client.patch(f"/api/builder/projects/{project['id']}", json={"status": "archived"})
    assert response.status_code == 422
    assert "archived" not in {member.value for member in BuilderProjectStatus}
    assert "archived" not in {member.value for member in VideoProjectStatus}


# ------------------------------------------------------------- thumbnail


@pytest.fixture
def two_versions(client: TestClient, video_models, budgeted, config) -> dict:
    project = client.post("/api/video/projects", json={"name": "thumb", "prompt": "밤"}).json()
    versions = [
        client.post(f"/api/video/projects/{project['id']}/versions").json() for _ in range(2)
    ]
    return {"id": project["id"], "versions": versions}


def listed(client: TestClient, project_id: int) -> dict:
    return next(p for p in client.get("/api/video/projects").json() if p["id"] == project_id)


def test_the_card_shows_the_latest_version_until_a_final_is_chosen(
    client: TestClient, two_versions
) -> None:
    card = listed(client, two_versions["id"])
    assert card["thumbnail_version_id"] == two_versions["versions"][1]["id"]
    assert card["thumbnail_kind"] == "image"  # the mock leaves a GIF
    assert card["thumbnail_aspect_ratio"] == two_versions["versions"][1]["aspect_ratio"]

    first = two_versions["versions"][0]["id"]
    client.patch(f"/api/video/projects/{two_versions['id']}", json={"final_version_id": first})
    assert listed(client, two_versions["id"])["thumbnail_version_id"] == first


def test_a_project_without_versions_has_no_thumbnail(client: TestClient, participating) -> None:
    project = client.post("/api/video/projects", json={"name": "empty"}).json()
    card = listed(client, project["id"])
    assert card["thumbnail_version_id"] is None
    assert card["thumbnail_kind"] is None
