"""Final version: the status it implies, and downloading any version.

The two fixes added before merging video-higgsfield-only (2026-10-07).
"""

import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import User, VideoProject, VideoProjectStatus, VideoVersion
from app.services.project_zip import version_filename


@pytest.fixture
def config(tmp_path):
    settings = Settings(storage_dir=str(tmp_path), app_env="development")
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def probe(client: TestClient, db_session: Session, video_models, budgeted, config) -> dict:
    """A project named `probe` with two generated versions, like the developer's."""
    project = client.post("/api/video/projects", json={"name": "probe", "prompt": "밤"}).json()
    versions = [
        client.post(f"/api/video/projects/{project['id']}/versions").json() for _ in range(2)
    ]
    return {"id": project["id"], "versions": versions}


def set_final(client: TestClient, project_id: int, version_id: int | None):
    return client.patch(f"/api/video/projects/{project_id}", json={"final_version_id": version_id})


# ------------------------------------------------------------- status rule


def test_choosing_a_final_version_makes_the_project_ready(client: TestClient, probe) -> None:
    assert client.get(f"/api/video/projects/{probe['id']}").json()["status"] == "draft"

    response = set_final(client, probe["id"], probe["versions"][1]["id"])

    assert response.json()["status"] == "ready"
    # The library reads the same status, so card and header agree.
    listed = next(p for p in client.get("/api/video/projects").json() if p["id"] == probe["id"])
    assert listed["status"] == "ready"


def test_clearing_the_final_version_puts_it_back_to_draft(client: TestClient, probe) -> None:
    set_final(client, probe["id"], probe["versions"][0]["id"])

    assert set_final(client, probe["id"], None).json()["status"] == "draft"


def test_a_project_with_a_final_cannot_be_sent_back_to_draft(client: TestClient, probe) -> None:
    response = client.patch(
        f"/api/video/projects/{probe['id']}",
        json={"final_version_id": probe["versions"][0]["id"], "status": "draft"},
    )
    assert response.json()["status"] == "ready"


def test_published_and_archived_are_left_alone(
    client: TestClient, db_session: Session, probe
) -> None:
    project = db_session.get(VideoProject, probe["id"])
    project.status = VideoProjectStatus.PUBLISHED
    db_session.commit()

    assert set_final(client, probe["id"], probe["versions"][0]["id"]).json()["status"] == "published"
    assert set_final(client, probe["id"], None).json()["status"] == "published"


def test_the_migration_applies_the_rule_to_existing_projects(
    db_session: Session, dev_user: User
) -> None:
    rows = [
        VideoProject(owner_user_id=dev_user.id, name="final draft", final_version_id=8),
        VideoProject(owner_user_id=dev_user.id, name="no final ready", status=VideoProjectStatus.READY),
        VideoProject(
            owner_user_id=dev_user.id,
            name="published",
            status=VideoProjectStatus.PUBLISHED,
            final_version_id=3,
        ),
        VideoProject(owner_user_id=dev_user.id, name="plain draft"),
    ]
    db_session.add_all(rows)
    db_session.commit()

    path = next(Path("alembic/versions").glob("4b8e2d6f1a90_*.py"))
    spec = importlib.util.spec_from_file_location("migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.op = type("Op", (), {"execute": staticmethod(lambda sql: db_session.execute(text(sql)))})
    migration.upgrade()
    db_session.commit()

    for row in rows:
        db_session.refresh(row)
    assert [row.status for row in rows] == [
        VideoProjectStatus.READY,
        VideoProjectStatus.DRAFT,
        VideoProjectStatus.PUBLISHED,
        VideoProjectStatus.DRAFT,
    ]


# ------------------------------------------------------ download any version


def test_any_version_with_a_file_downloads_final_or_not(client: TestClient, probe) -> None:
    set_final(client, probe["id"], probe["versions"][1]["id"])

    for version in probe["versions"]:
        response = client.get(
            f"/api/video/projects/{probe['id']}/versions/{version['id']}/download"
        )
        assert response.status_code == 200, version["label"]


def test_the_file_is_named_project_underscore_version(client: TestClient, probe) -> None:
    version = probe["versions"][1]
    disposition = client.get(
        f"/api/video/projects/{probe['id']}/versions/{version['id']}/download"
    ).headers["content-disposition"]

    assert "filename*=UTF-8''probe_v2.gif" in disposition
    assert 'filename="video_v2.gif"' in disposition


def test_the_name_keeps_korean_and_drops_what_a_filesystem_cannot_take() -> None:
    assert version_filename("probe", "v8", "gif") == "probe_v8.gif"
    assert version_filename("밤/의:서울", "v2", "mp4") == "밤의서울_v2.mp4"
    assert version_filename("...", "v1", "gif") == "video_v1.gif"


def test_the_library_says_whether_the_final_has_a_file(
    client: TestClient, db_session: Session, probe
) -> None:
    def listed() -> dict:
        return next(p for p in client.get("/api/video/projects").json() if p["id"] == probe["id"])

    assert listed()["final_version_has_asset"] is False  # no final yet

    set_final(client, probe["id"], probe["versions"][0]["id"])
    assert listed()["final_version_has_asset"] is True

    # A final made before files were stored: chosen, but nothing to download.
    old = VideoVersion(project_id=probe["id"], provider="higgsfield", model_id="kling-3.0-pro")
    db_session.add(old)
    db_session.commit()
    set_final(client, probe["id"], old.id)
    assert listed()["final_version_has_asset"] is False
