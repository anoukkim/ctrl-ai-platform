"""Downloading a generated video, and the storage underneath it.

Higgsfield does not exist yet, so the mock provider leaves a real file
behind — `project-video-management` asks for exactly that, "so the
download flow can be tested end to end". These tests are what "end to
end" means here: a version is generated, a file is stored, and the owner
gets the bytes back with a name they can read.

The access rule is the interesting one and matches the Builder ZIP: a
member who is **not** participating may still download. Their work is
theirs; what they lose is the ability to make more of it.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import MembershipStatus, User, VideoProject, VideoVersion
from app.services import placeholder_clip, video_assets
from app.services.quarters import set_membership
from app.services.storage import LocalAssetStorage, StorageKeyError, check_key, get_storage


@pytest.fixture
def storage_dir(tmp_path):
    """Point the app's storage at a throwaway directory.

    Through FastAPI's dependency overrides rather than by setting an
    environment variable: `get_settings` is cached for the life of the
    process, so an env change would reach some tests and not others
    depending on what ran first. The override is removed afterwards so no
    other test inherits this directory.
    """
    settings = Settings(storage_dir=str(tmp_path), app_env="development")
    app.dependency_overrides[get_settings] = lambda: settings
    yield tmp_path
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def version(client: TestClient, db_session: Session, dev_user: User, video_models, budgeted,
            storage_dir) -> VideoVersion:
    """One generated version, made the way the workspace makes it."""
    created = client.post("/api/video/projects", json={"name": "밤의 서울", "prompt": "야경"})
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]

    made = client.post(
        f"/api/video/projects/{project_id}/versions", json={"aspect_ratio": "9:16"}
    )
    assert made.status_code == 201, made.text

    return db_session.get(VideoVersion, made.json()["id"])


# ------------------------------------------------------------- the storage


def test_a_key_may_not_climb_out_of_the_store() -> None:
    for key in [
        "../escape.gif",
        "video/../../etc/passwd",
        "/etc/passwd",
        "C:/windows/system.ini",
        "video\\1\\2.gif",
        "",
        "video//1.gif",
        ".hidden/1.gif",
        "video/./1.gif",
    ]:
        with pytest.raises(StorageKeyError):
            check_key(key)


def test_a_normal_key_is_accepted() -> None:
    assert check_key("video/11/42.gif") == "video/11/42.gif"


def test_local_storage_round_trips(tmp_path) -> None:
    storage = LocalAssetStorage(tmp_path)

    storage.save("video/1/2.gif", b"bytes")

    assert storage.exists("video/1/2.gif")
    assert storage.load("video/1/2.gif") == b"bytes"
    storage.delete("video/1/2.gif")
    assert not storage.exists("video/1/2.gif")


def test_local_storage_refuses_to_write_outside_its_root(tmp_path) -> None:
    storage = LocalAssetStorage(tmp_path / "store")

    with pytest.raises(StorageKeyError):
        storage.save("../outside.gif", b"x")

    assert not (tmp_path / "outside.gif").exists()


def test_the_configured_backend_is_the_local_one_by_default(tmp_path) -> None:
    storage = get_storage(Settings(storage_dir=str(tmp_path)))
    assert isinstance(storage, LocalAssetStorage)


def test_an_unknown_backend_fails_loudly(tmp_path) -> None:
    """Better than silently keeping files nowhere."""
    with pytest.raises(ValueError):
        get_storage(Settings(storage_backend="dropbox", storage_dir=str(tmp_path)))


# ----------------------------------------------------------- the placeholder


def test_the_placeholder_is_a_real_animated_gif() -> None:
    data = placeholder_clip.build()

    assert data.startswith(b"GIF89a")
    assert data.endswith(b"\x3b")
    # Animated and looping, not one still frame.
    assert data.count(b"\x21\xf9\x04") == 8
    assert b"NETSCAPE2.0" in data


def test_the_placeholder_follows_the_asked_for_shape() -> None:
    tall = video_assets.make_placeholder("9:16")
    wide = video_assets.make_placeholder("16:9")

    # Width and height live at bytes 6..10 of a GIF header.
    assert int.from_bytes(tall.data[6:8], "little") < int.from_bytes(tall.data[8:10], "little")
    assert int.from_bytes(wide.data[6:8], "little") > int.from_bytes(wide.data[8:10], "little")


def test_an_unknown_ratio_gives_a_square_rather_than_a_guess() -> None:
    asset = video_assets.make_placeholder(None)

    assert asset.data[6:8] == asset.data[8:10]


# --------------------------------------------------------------- generating


def test_generating_leaves_a_file_behind(version: VideoVersion, storage_dir) -> None:
    assert version.asset_storage_key is not None
    assert (storage_dir / version.asset_storage_key).is_file()
    assert (storage_dir / version.asset_storage_key).read_bytes().startswith(b"GIF89a")


def test_the_version_tells_the_screen_it_can_be_downloaded(
    client: TestClient, version: VideoVersion, storage_dir
) -> None:
    body = client.get(f"/api/video/projects/{version.project_id}").json()

    assert body["versions"][0]["has_asset"] is True
    # The key itself is the backend's business and never leaves it.
    assert "asset_storage_key" not in body["versions"][0]


# --------------------------------------------------------------- the route


def test_the_owner_downloads_the_file(
    client: TestClient, version: VideoVersion, storage_dir
) -> None:
    response = client.get(
        f"/api/video/projects/{version.project_id}/versions/{version.id}/download"
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/gif"
    assert response.content.startswith(b"GIF89a")


def test_the_download_name_carries_the_project_and_the_version(
    client: TestClient, version: VideoVersion, storage_dir
) -> None:
    disposition = client.get(
        f"/api/video/projects/{version.project_id}/versions/{version.id}/download"
    ).headers["content-disposition"]

    assert disposition.startswith("attachment;")
    assert "filename*=UTF-8''" in disposition
    assert "%EB%B0%A4%EC%9D%98" in disposition  # 밤의, percent-encoded
    assert "v1" in disposition


def test_an_inactive_owner_may_still_download(
    client: TestClient, db_session: Session, dev_user: User, version: VideoVersion,
    participating, storage_dir
) -> None:
    """The point of the feature, as with the Builder ZIP."""
    set_membership(db_session, dev_user.id, participating.id, MembershipStatus.INACTIVE)
    db_session.commit()

    # Generating another is refused …
    assert client.post(
        f"/api/video/projects/{version.project_id}/versions"
    ).status_code == 403
    # … and downloading what they already made is not.
    assert client.get(
        f"/api/video/projects/{version.project_id}/versions/{version.id}/download"
    ).status_code == 200


def test_another_member_cannot_download_my_video(
    version: VideoVersion, other_client: TestClient, storage_dir
) -> None:
    """`version` comes first on purpose.

    `client` and `other_client` are the same TestClient with different
    cookies, so whichever signs in last owns the session. Making the
    video first and signing in as the other member second is what puts
    the right person behind the request.
    """
    assert (
        other_client.get(
            f"/api/video/projects/{version.project_id}/versions/{version.id}/download"
        ).status_code
        == 404
    )


def test_a_deleted_project_s_videos_cannot_be_downloaded(
    client: TestClient, version: VideoVersion, budgeted, storage_dir
) -> None:
    client.delete(f"/api/video/projects/{version.project_id}")

    assert (
        client.get(
            f"/api/video/projects/{version.project_id}/versions/{version.id}/download"
        ).status_code
        == 404
    )


def test_a_version_with_no_file_says_so_rather_than_failing(
    client: TestClient, db_session: Session, dev_user: User, storage_dir
) -> None:
    """Versions made before any of this exist and have no file."""
    project = VideoProject(owner_user_id=dev_user.id, name="옛 프로젝트")
    db_session.add(project)
    db_session.flush()
    old = VideoVersion(
        project_id=project.id, provider="higgsfield", model_id="kling", prompt_snapshot=""
    )
    db_session.add(old)
    db_session.commit()

    response = client.get(f"/api/video/projects/{project.id}/versions/{old.id}/download")

    assert response.status_code == 409
    assert "아직 내려받을 수 있는 영상이 없습니다" in response.json()["detail"]


def test_a_version_of_another_project_is_not_found(
    client: TestClient, db_session: Session, dev_user: User, version: VideoVersion, storage_dir
) -> None:
    """The version id must belong to the project in the path."""
    other = VideoProject(owner_user_id=dev_user.id, name="다른 프로젝트")
    db_session.add(other)
    db_session.commit()

    assert (
        client.get(
            f"/api/video/projects/{other.id}/versions/{version.id}/download"
        ).status_code
        == 404
    )


def test_a_missing_file_is_reported_not_crashed(
    client: TestClient, version: VideoVersion, storage_dir
) -> None:
    """The row says there is a file and there is not — say so."""
    (storage_dir / version.asset_storage_key).unlink()

    response = client.get(
        f"/api/video/projects/{version.project_id}/versions/{version.id}/download"
    )

    assert response.status_code == 404
    assert "다시 생성해" in response.json()["detail"]
