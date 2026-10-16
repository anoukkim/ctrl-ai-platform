"""feedback-screenshots — screenshots attached to a 의견 보내기 note.

What is proved: PNG, JPEG and WebP are accepted by their bytes and stored
re-encoded with EXIF gone; a GIF, a PDF, a renamed file, a file over
5 MB and a fourth picture are refused with their Korean sentence and
nothing stored; a note names its pictures and Admin's list shows them;
only an admin opens a stored picture (member 403, signed out 401);
another member's waiting picture is a 404 to remove and "not found" to
send; a picture left in a closed dialog goes with the next note; an
admin deleting a note deletes its pictures' rows and bytes and is
audited; withdrawal anonymisation deletes the member's pictures and
keeps the notes; the upload refuses the "simple" content types.
"""

import io
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.jobs import anonymise_withdrawn
from app.main import app
from app.models import AuditLog, Feedback, FeedbackImage
from app.services import withdrawal as withdrawal_service
from app.services.storage import get_storage
from tests.conftest import DEV_PASSWORD, JSON_HEADERS, MEMBER_PASSWORD
from tests.test_chat_files import jpeg_with_gps, pdf, png, webp


@pytest.fixture
def storage_settings(tmp_path):
    settings = Settings(app_env="development", storage_dir=str(tmp_path / "storage"))
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def admin_client(other_client: TestClient, dev_user) -> Generator[TestClient, None, None]:
    """A second, independent client signed in as the admin — `other_client`
    and `client` share one cookie jar, so the last sign-in would win."""
    with TestClient(app, headers=JSON_HEADERS) as admin:
        response = admin.post("/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD})
        assert response.status_code == 200, response.text
        yield admin


def upload(client: TestClient, name: str, data: bytes, content_type: str = "application/octet-stream"):
    return client.post(
        "/api/feedback/images",
        params={"name": name},
        content=data,
        headers={"content-type": content_type},
    )


def gif() -> bytes:
    out = io.BytesIO()
    Image.new("P", (20, 20), 1).save(out, format="GIF")
    return out.getvalue()


def stored_files(settings: Settings) -> list[Path]:
    root = Path(settings.storage_dir)
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


def images(db: Session) -> list[FeedbackImage]:
    return list(db.scalars(select(FeedbackImage).order_by(FeedbackImage.id)))


# ------------------------------------------------------------- accepted


@pytest.mark.parametrize(
    ("name", "make", "media_type"),
    [
        ("screen.png", png, "image/png"),
        ("photo.jpg", lambda: jpeg_with_gps(800, 600), "image/jpeg"),
        ("photo.jpeg", lambda: jpeg_with_gps(800, 600), "image/jpeg"),
        ("shot.webp", webp, "image/webp"),
    ],
)
def test_png_jpeg_webp_are_accepted_by_their_bytes(
    client: TestClient, db_session: Session, storage_settings, name, make, media_type
) -> None:
    response = upload(client, name, make())
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == name
    assert body["media_type"] == media_type
    assert body["width"] > 0 and body["height"] > 0
    [row] = images(db_session)
    assert row.feedback_id is None
    assert get_storage(storage_settings).exists(row.storage_key)


def test_a_phone_photo_is_stored_without_exif_and_scaled(
    client: TestClient, db_session: Session, storage_settings
) -> None:
    original = jpeg_with_gps(4000, 3000)
    assert Image.open(io.BytesIO(original)).getexif()
    response = upload(client, "IMG_0001.jpg", original)
    assert response.status_code == 201, response.text
    [row] = images(db_session)
    stored = Image.open(io.BytesIO(get_storage(storage_settings).load(row.storage_key)))
    assert not stored.getexif()
    assert "exif" not in stored.info
    assert max(stored.size) == 2560  # legible, larger than Chat's 1,568
    assert row.stored_size < len(original)


# ------------------------------------------------------------- refused, nothing stored


@pytest.mark.parametrize(
    ("name", "make", "status_code", "detail"),
    [
        ("anim.gif", gif, 400, "PNG, JPG, WebP 이미지만 올릴 수 있어요."),
        ("doc.pdf", pdf, 400, "PNG, JPG, WebP 이미지만 올릴 수 있어요."),
        ("renamed.png", lambda: jpeg_with_gps(80, 60), 400, "PNG, JPG, WebP 이미지만 올릴 수 있어요."),
        ("notes.txt", lambda: b"hello", 400, "PNG, JPG, WebP 이미지만 올릴 수 있어요."),
        ("broken.png", lambda: b"\x89PNG\r\n\x1a\n" + b"\x00" * 40, 400, "파일을 열 수 없습니다"),
    ],
)
def test_other_kinds_are_refused_in_korean_and_nothing_is_stored(
    client: TestClient, db_session: Session, storage_settings, name, make, status_code, detail
) -> None:
    response = upload(client, name, make())
    assert response.status_code == status_code, response.text
    assert detail in response.json()["detail"]
    assert images(db_session) == []
    assert stored_files(storage_settings) == []


def test_over_5mb_is_refused_without_being_kept(client: TestClient, db_session: Session, storage_settings) -> None:
    big = png(10, 10) + b"\x00" * (5 * 1024 * 1024)
    response = upload(client, "huge.png", big)
    assert response.status_code == 413, response.text
    assert response.json()["detail"] == "사진이 너무 커요 (1장 5MB 이하)."
    assert images(db_session) == []
    assert stored_files(storage_settings) == []


def test_a_fourth_picture_is_refused(client: TestClient, db_session: Session, storage_settings) -> None:
    for index in range(3):
        assert upload(client, f"s{index}.png", png()).status_code == 201
    response = upload(client, "s3.png", png())
    assert response.status_code == 400
    assert response.json()["detail"] == "사진은 3장까지 붙일 수 있어요."
    assert len(images(db_session)) == 3
    assert len(stored_files(storage_settings)) == 3


def test_pictures_left_behind_for_an_hour_do_not_block_the_next_upload(
    client: TestClient, db_session: Session, storage_settings
) -> None:
    for index in range(3):
        assert upload(client, f"s{index}.png", png()).status_code == 201
    assert upload(client, "s3.png", png()).status_code == 400
    # Age them past the sweep, as a closed tab would have left them.
    for row in images(db_session):
        row.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
    db_session.commit()

    response = upload(client, "fresh.png", png())
    assert response.status_code == 201, response.text
    [row] = images(db_session)
    assert row.original_name == "fresh.png"
    assert len(stored_files(storage_settings)) == 1


def test_a_simple_content_type_is_refused(client: TestClient, db_session: Session, storage_settings) -> None:
    response = upload(client, "s.png", png(), content_type="text/plain")
    assert response.status_code == 415
    assert images(db_session) == []


def test_uploading_needs_sign_in(anon_client: TestClient, storage_settings) -> None:
    assert upload(anon_client, "s.png", png()).status_code == 401


# ------------------------------------------------------------- the note


def send(client: TestClient, body: str, image_ids: list[int]):
    return client.post("/api/feedback", json={"body": body, "page": "/chat", "image_ids": image_ids})


def test_a_note_carries_its_pictures_and_admin_sees_them(
    other_client: TestClient, admin_client: TestClient, db_session: Session, storage_settings
) -> None:
    ids = [upload(other_client, f"s{i}.png", png(60, 40)).json()["id"] for i in range(2)]
    sent = send(other_client, "버튼이 안 눌려요", ids)
    assert sent.status_code == 201, sent.text
    assert [image["id"] for image in sent.json()["images"]] == ids

    rows = images(db_session)
    assert [row.feedback_id for row in rows] == [sent.json()["id"]] * 2

    listed = admin_client.get("/api/admin/feedback").json()
    [note] = [row for row in listed if row["id"] == sent.json()["id"]]
    assert [image["id"] for image in note["images"]] == ids
    assert note["images"][0]["width"] == 60

    shown = admin_client.get(f"/api/admin/feedback/images/{ids[0]}/file")
    assert shown.status_code == 200
    assert shown.headers["content-type"] == "image/png"
    assert shown.headers["content-disposition"].startswith("inline;")
    assert Image.open(io.BytesIO(shown.content)).size == (60, 40)


def test_only_an_admin_opens_a_stored_picture(
    other_client: TestClient, anon_client: TestClient, db_session: Session, storage_settings
) -> None:
    image_id = upload(other_client, "s.png", png()).json()["id"]
    assert send(other_client, "안 돼요", [image_id]).status_code == 201
    # The uploader included: there is no member route back to a picture.
    assert other_client.get(f"/api/admin/feedback/images/{image_id}/file").status_code == 403
    assert other_client.get("/api/admin/feedback").status_code == 403
    other_client.post("/api/auth/logout")
    assert anon_client.get(f"/api/admin/feedback/images/{image_id}/file").status_code == 401


def test_a_waiting_picture_is_not_served_even_to_an_admin(client: TestClient, storage_settings) -> None:
    image_id = upload(client, "s.png", png()).json()["id"]
    assert client.get(f"/api/admin/feedback/images/{image_id}/file").status_code == 404
    assert client.get("/api/admin/feedback/images/9999/file").status_code == 404


def test_another_members_waiting_picture_is_not_found(
    other_client: TestClient, admin_client: TestClient, db_session: Session, storage_settings
) -> None:
    image_id = upload(other_client, "s.png", png()).json()["id"]
    # Removing it: 404. Naming it in a note: refused, nothing saved.
    assert admin_client.delete(f"/api/feedback/images/{image_id}").status_code == 404
    refused = send(admin_client, "남의 사진", [image_id])
    assert refused.status_code == 400
    assert refused.json()["detail"] == "사진을 찾을 수 없어요. 다시 붙여 주세요."
    assert db_session.scalar(select(Feedback)) is None
    [row] = images(db_session)
    assert row.feedback_id is None  # still waiting for its own uploader


def test_removing_a_waiting_picture_deletes_its_bytes(
    client: TestClient, db_session: Session, storage_settings
) -> None:
    image_id = upload(client, "s.png", png()).json()["id"]
    assert len(stored_files(storage_settings)) == 1
    assert client.delete(f"/api/feedback/images/{image_id}").status_code == 204
    assert images(db_session) == []
    assert stored_files(storage_settings) == []


def test_a_sent_picture_cannot_be_removed_by_the_member(client: TestClient, storage_settings) -> None:
    image_id = upload(client, "s.png", png()).json()["id"]
    assert send(client, "보냄", [image_id]).status_code == 201
    assert client.delete(f"/api/feedback/images/{image_id}").status_code == 409


def test_more_than_three_ids_are_refused(client: TestClient, db_session: Session, storage_settings) -> None:
    refused = send(client, "많이", [1, 2, 3, 4])
    assert refused.status_code == 400
    assert refused.json()["detail"] == "사진은 3장까지 붙일 수 있어요."
    assert db_session.scalar(select(Feedback)) is None


def test_a_picture_left_in_a_closed_dialog_goes_with_the_next_note(
    client: TestClient, db_session: Session, storage_settings
) -> None:
    abandoned = upload(client, "old.png", png()).json()["id"]
    kept = upload(client, "new.png", png()).json()["id"]
    sent = send(client, "두 번째 시도", [kept])
    assert sent.status_code == 201
    rows = images(db_session)
    assert [row.id for row in rows] == [kept]
    assert rows[0].feedback_id == sent.json()["id"]
    assert len(stored_files(storage_settings)) == 1
    assert client.delete(f"/api/feedback/images/{abandoned}").status_code == 404


def test_a_note_without_pictures_still_works(client: TestClient) -> None:
    sent = client.post("/api/feedback", json={"body": "글만", "page": "/usage"})
    assert sent.status_code == 201
    assert sent.json()["images"] == []


# ------------------------------------------------------------- deletion


def test_admin_deleting_a_note_deletes_its_pictures_and_is_audited(
    other_client: TestClient, admin_client: TestClient, db_session: Session, storage_settings
) -> None:
    ids = [upload(other_client, f"s{i}.png", png()).json()["id"] for i in range(2)]
    note_id = send(other_client, "지워 주세요", ids).json()["id"]
    assert len(stored_files(storage_settings)) == 2

    assert admin_client.delete(f"/api/admin/feedback/{note_id}").status_code == 204
    assert db_session.get(Feedback, note_id) is None
    assert images(db_session) == []
    assert stored_files(storage_settings) == []
    [entry] = list(db_session.scalars(select(AuditLog).where(AuditLog.action == "feedback.deleted")))
    assert entry.target_id == note_id
    assert entry.target_label == "other"
    assert "사진 2장" in entry.summary
    assert entry.detail["images"] == 2

    assert admin_client.delete(f"/api/admin/feedback/{note_id}").status_code == 404


def test_a_member_cannot_delete_a_note(other_client: TestClient, admin_client: TestClient, storage_settings) -> None:
    note_id = admin_client.post("/api/feedback", json={"body": "관리자 글"}).json()["id"]
    assert other_client.delete(f"/api/admin/feedback/{note_id}").status_code == 403


def test_anonymisation_deletes_the_members_pictures_and_keeps_the_note(
    other_client: TestClient, other_user, db_session: Session, storage_settings, monkeypatch
) -> None:
    image_id = upload(other_client, "s.png", png()).json()["id"]
    note_id = send(other_client, "탈퇴 전에 남긴 말", [image_id]).json()["id"]
    waiting = upload(other_client, "w.png", png()).json()["id"]
    assert len(stored_files(storage_settings)) == 2

    assert other_client.post("/api/account/withdrawal", json={"password": MEMBER_PASSWORD}).status_code == 200
    row = withdrawal_service.open_withdrawal(db_session, other_user.id)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    row.withdrawn_at = past - timedelta(days=30)
    row.grace_ends_at = past
    db_session.commit()
    # The job reads settings itself, not through the request override.
    monkeypatch.setattr("app.core.config.get_settings", lambda: storage_settings)
    result = anonymise_withdrawn.run(db_session)
    assert result.anonymised == [other_user.id]

    assert images(db_session) == []
    assert stored_files(storage_settings) == []
    note = db_session.get(Feedback, note_id)
    assert note is not None and note.body == "탈퇴 전에 남긴 말"
    assert db_session.get(FeedbackImage, waiting) is None
