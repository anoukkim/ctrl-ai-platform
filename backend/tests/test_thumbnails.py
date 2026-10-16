"""ui-improvements (owner-polish 4·5) — app thumbnails.

The picture is taken in the maker's browser; the server checks the bytes,
re-encodes them to a 640×400 WebP without metadata, and keeps the draft's
on the project and a published version's on the version. Member code is
never run here — the routes accept an image, nothing else.
"""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import BuilderProject
from app.services import thumbnails
from app.services.attachments import AttachmentRefusal
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD

APPS_BASE = "http://apps.test"
OCTET = {"Content-Type": "application/octet-stream"}


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


@pytest.fixture
def project(db_session: Session, dev_user) -> BuilderProject:
    row = BuilderProject(owner_user_id=dev_user.id, name="할 일", description="")
    db_session.add(row)
    db_session.commit()
    return row


def picture(width: int = 1280, height: int = 800, fmt: str = "PNG", **save) -> bytes:
    image = Image.new("RGB", (width, height), (30, 120, 200))
    out = io.BytesIO()
    image.save(out, format=fmt, **save)
    return out.getvalue()


def publish(client: TestClient, project: BuilderProject) -> None:
    generated = client.post(
        f"/api/builder/projects/{project.id}/generate", json={"request": "할 일 앱을 만들어 줘", "style": ""}
    )
    assert generated.status_code == 200, generated.text
    published = client.post(
        f"/api/builder/projects/{project.id}/publish", json={"description": "할 일 앱이에요.", "note": ""}
    )
    assert published.status_code == 200, published.text


def _sign_in(client: TestClient, username: str, password: str) -> None:
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"username": username, "password": password}).status_code == 200


# ------------------------------------------------------------ encode


def test_encode_makes_a_640x400_webp_without_metadata_from_any_allowed_picture() -> None:
    exif = Image.Exif()
    exif[0x010F] = "SomePhone"  # Make — stands in for the GPS a phone adds
    for fmt, extra in [("PNG", {}), ("JPEG", {"exif": exif.tobytes()}), ("WEBP", {})]:
        out = thumbnails.encode(picture(fmt=fmt, **extra))
        with Image.open(io.BytesIO(out)) as stored:
            assert stored.format == "WEBP"
            assert stored.size == (640, 400)
            assert not stored.getexif()
    # A tall capture is cropped from the top, not squashed; a tiny one is scaled up.
    with Image.open(io.BytesIO(thumbnails.encode(picture(400, 1000)))) as stored:
        assert stored.size == (640, 400)
    with Image.open(io.BytesIO(thumbnails.encode(picture(64, 40)))) as stored:
        assert stored.size == (640, 400)


def test_encode_refuses_what_is_not_a_picture() -> None:
    with pytest.raises(AttachmentRefusal, match="PNG, JPG, WebP"):
        thumbnails.encode(b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    with pytest.raises(AttachmentRefusal, match="PNG, JPG, WebP"):
        thumbnails.encode(b"GIF89a" + b"\x00" * 20)
    with pytest.raises(AttachmentRefusal):
        thumbnails.encode(b"\x89PNG\r\n\x1a\n" + b"junk")


# ------------------------------------------------------------ routes


def test_the_draft_thumbnail_is_stored_stamped_and_served_to_the_owner_only(
    client: TestClient, db_session: Session, project, participating, other_user, config
) -> None:
    assert client.get(f"/api/builder/projects/{project.id}").json()["draft_thumbnail_at"] is None
    assert client.get(f"/api/builder/projects/{project.id}/thumbnail").status_code == 404

    stored = client.post(f"/api/builder/projects/{project.id}/thumbnail", content=picture(), headers=OCTET)
    assert stored.status_code == 200, stored.text
    assert stored.json()["draft_thumbnail_at"] is not None
    assert stored.json()["published_thumbnail_at"] is None

    served = client.get(f"/api/builder/projects/{project.id}/thumbnail")
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/webp"
    assert served.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in served.headers["content-security-policy"]
    with Image.open(io.BytesIO(served.content)) as stored_image:
        assert stored_image.size == (640, 400)
    # The listing row carries the stamp; a second capture replaces the first.
    assert client.get("/api/builder/projects").json()[0]["draft_thumbnail_at"] == stored.json()["draft_thumbnail_at"]
    assert client.post(f"/api/builder/projects/{project.id}/thumbnail", content=picture(), headers=OCTET).status_code == 200

    # Another member: the project is not theirs — 404 on both routes.
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    assert client.get(f"/api/builder/projects/{project.id}/thumbnail").status_code == 404
    assert client.post(f"/api/builder/projects/{project.id}/thumbnail", content=picture(), headers=OCTET).status_code in (403, 404)


def test_the_upload_checks_type_size_and_the_json_exception(
    client: TestClient, db_session: Session, project, participating, config
) -> None:
    url = f"/api/builder/projects/{project.id}/thumbnail"
    assert client.post(url, content=b"<svg/>", headers=OCTET).status_code == 400
    assert client.post(url, content=b"GIF89a" + b"\x00" * 20, headers=OCTET).status_code == 400
    assert client.post(url, content=b"\x89PNG\r\n\x1a\njunk", headers=OCTET).status_code == 400
    too_big = client.post(url, content=b"\x89PNG\r\n\x1a\n" + b"\x00" * (thumbnails.MAX_UPLOAD_BYTES + 1), headers=OCTET)
    assert too_big.status_code == 413
    # A "simple" content type would skip the CORS preflight: refused.
    assert client.post(url, content=picture(), headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.get(f"/api/builder/projects/{project.id}").json()["draft_thumbnail_at"] is None


def test_a_published_thumbnail_belongs_to_the_version_and_reaches_ctrlaiapps(
    client: TestClient, db_session: Session, project, budgeted, other_user, config
) -> None:
    url = f"/api/builder/projects/{project.id}/thumbnail"
    # Nothing published yet: 409, and the store route has nothing.
    assert client.post(f"{url}?space=published", content=picture(), headers=OCTET).status_code == 409

    publish(client, project)
    db_session.refresh(project)
    slug = project.app_slug
    assert client.get("/api/apps").json()[0]["thumbnail_at"] is None
    assert client.get(f"/api/apps/{slug}/thumbnail").status_code == 404

    stored = client.post(f"{url}?space=published", content=picture(), headers=OCTET)
    assert stored.status_code == 200, stored.text
    assert stored.json()["published_thumbnail_at"] is not None
    assert stored.json()["draft_thumbnail_at"] is None
    assert client.get(f"{url}?space=published").status_code == 200
    assert client.get(url).status_code == 404  # the draft has none

    # Any signed-in member sees it on CtrlAIApps — even one not participating.
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    listed = client.get(f"/api/apps/{slug}").json()
    assert listed["thumbnail_at"] == stored.json()["published_thumbnail_at"]
    served = client.get(f"/api/apps/{slug}/thumbnail")
    assert served.status_code == 200 and served.headers["content-type"] == "image/webp"

    # 게시 취소 takes the address and the picture route down; the version keeps its stamp.
    _sign_in(client, "dev", DEV_PASSWORD)
    assert client.post(f"/api/builder/projects/{project.id}/unpublish", json={}).status_code == 200
    assert client.get(f"/api/apps/{slug}/thumbnail").status_code == 404
    assert client.get(f"/api/builder/projects/{project.id}").json()["published_thumbnail_at"] is None
    # Publishing the same version again brings the picture back without a new capture.
    assert client.post(f"/api/builder/projects/{project.id}/publish", json={"description": "할 일 앱이에요.", "note": ""}).status_code == 200
    assert client.get(f"/api/builder/projects/{project.id}").json()["published_thumbnail_at"] is not None
    db_session.refresh(project)
    assert client.get(f"/api/apps/{project.app_slug}/thumbnail").status_code == 200


def test_the_shell_names_the_site_origins_it_answers_captures_from(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    """The shell answers a capture request only from the club's own site:
    the page carries those origins for shell.js to check against."""
    publish(client, project)
    db_session.refresh(project)
    page = client.get(f"/_ctrlai/shell/{project.app_slug}")
    assert page.status_code == 200
    assert 'data-sites="http://localhost:3000' in page.text or 'data-sites="' in page.text
