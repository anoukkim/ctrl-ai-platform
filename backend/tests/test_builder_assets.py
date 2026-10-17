"""builder-images (2) — pictures that are part of the app.

A picture added to the project lives at images/<name>, is written into
the app's folder beside its files (preview and published), packed into
the ZIP, named to Claude in every staged call, and purged with the
project. Owner only; free.
"""

import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from app.models import BuilderAsset, BuilderProject, UsageEvent
from app.services import app_runtime, builder_assets
from app.services.storage import get_storage
from tests.conftest import MEMBER_PASSWORD
from tests.test_builder_stages import config, plan, run  # noqa: F401 — the fixture
from tests.test_thumbnails import publish

OCTET = {"Content-Type": "application/octet-stream"}


@pytest.fixture
def project(db_session: Session, dev_user) -> BuilderProject:
    row = BuilderProject(owner_user_id=dev_user.id, name="동네 빵집", description="")
    db_session.add(row)
    db_session.commit()
    return row


def picture(width: int = 3000, height: int = 2000, fmt: str = "PNG") -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (10, 140, 90)).save(out, format=fmt)
    return out.getvalue()


def add(client: TestClient, project: BuilderProject, data: bytes, name: str):
    return client.post(f"/api/builder/projects/{project.id}/assets?name={name}", content=data, headers=OCTET)


def test_a_picture_gets_a_safe_path_under_images_and_is_free(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    first = add(client, project, picture(), "My Logo!.png")
    assert first.status_code == 201, first.text
    assert first.json()["path"] == "images/my-logo.png"
    assert max(first.json()["width"], first.json()["height"]) == builder_assets.LONG_EDGE
    again = add(client, project, picture(400, 400, "JPEG"), "My Logo!.jpg").json()
    assert again["path"] == "images/my-logo.jpg"
    third = add(client, project, picture(400, 400), "my logo.png").json()
    assert third["path"] == "images/my-logo-2.png"
    assert add(client, project, picture(), "../../etc/passwd.png").json()["path"] == "images/passwd.png"
    hangul = add(client, project, picture(200, 200), "가게 사진.png").json()
    assert hangul["path"] == "images/가게-사진.png"
    db_session.expire_all()
    assert sum(event.charged_krw for event in db_session.query(UsageEvent).all()) == 0
    listed = client.get(f"/api/builder/projects/{project.id}/assets").json()
    assert len(listed) == 5
    served = client.get(f"/api/builder/projects/{project.id}/assets/{first.json()['id']}/file")
    assert served.status_code == 200 and served.headers["content-type"] == "image/png"


def test_only_pictures_and_the_limits(client: TestClient, db_session: Session, project, budgeted, config) -> None:
    assert add(client, project, b"<svg/>", "x.svg").status_code == 400
    assert add(client, project, b"\x89PNG broken", "x.png").status_code == 400
    for index in range(builder_assets.MAX_ASSETS):
        assert add(client, project, picture(50, 50), f"p{index}.png").status_code == 201
    refused = add(client, project, picture(50, 50), "one-more.png")
    assert refused.status_code == 400 and "10장" in refused.json()["detail"]


def test_the_picture_is_in_the_preview_the_published_app_and_the_zip(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    publish(client, project)
    row = add(client, project, picture(), "logo.png").json()
    db_session.expire_all()
    fresh = db_session.get(BuilderProject, project.id)
    root = app_runtime.apps_root(config)
    # The preview was written again at once.
    assert (root / fresh.draft_slug / "images" / "logo.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    # The next 게시 carries it to the public folder.
    publish(client, project)
    db_session.expire_all()
    fresh = db_session.get(BuilderProject, project.id)
    assert (root / fresh.app_slug / "images" / "logo.png").exists()
    # The ZIP has it, as bytes.
    archive = client.get(f"/api/builder/projects/{project.id}/download")
    assert archive.status_code == 200
    with zipfile.ZipFile(io.BytesIO(archive.content)) as packed:
        assert packed.read("images/logo.png")[:8] == b"\x89PNG\r\n\x1a\n"
    # Removing it takes it out of the preview.
    assert client.delete(f"/api/builder/projects/{project.id}/assets/{row['id']}").status_code == 204
    assert not (root / fresh.draft_slug / "images" / "logo.png").exists()


def test_claude_is_told_about_the_pictures(client: TestClient, db_session: Session, project, budgeted, config) -> None:
    assert builder_assets.note(db_session, project) == ""
    add(client, project, picture(800, 400), "logo.png")
    note = builder_assets.note(db_session, project)
    assert "images/logo.png (800×400)" in note and "<img" in note
    # The staged calls carry it (the plan's input grows by the note).
    planned = plan(client, project, "빵집 소개 앱")
    assert planned.status_code == 201, planned.text


def test_another_member_cannot_see_or_change_them(
    client: TestClient, db_session: Session, project, budgeted, other_user, config
) -> None:
    row = add(client, project, picture(50, 50), "logo.png").json()
    client.post("/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD})
    assert client.get(f"/api/builder/projects/{project.id}/assets").status_code == 404
    assert client.get(f"/api/builder/projects/{project.id}/assets/{row['id']}/file").status_code == 404
    assert client.delete(f"/api/builder/projects/{project.id}/assets/{row['id']}").status_code in (403, 404)


def test_purge_removes_the_pictures(client: TestClient, db_session: Session, project, budgeted, config) -> None:
    from datetime import datetime, timezone

    from app.services import purge

    row = add(client, project, picture(50, 50), "logo.png").json()
    key = f"builder-asset/{project.id}/{row['id']}"
    assert get_storage(config).exists(key)
    db_session.expire_all()
    fresh = db_session.get(BuilderProject, project.id)
    fresh.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    facts = purge.purge(db_session, fresh)
    db_session.commit()
    purge.remove_files(config, get_storage(config), [facts])
    assert not get_storage(config).exists(key)
    assert db_session.query(BuilderAsset).count() == 0
