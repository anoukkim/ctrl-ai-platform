"""chat-plus-files — files attached to a Chat message, against the mock Claude.

What is proved: each format is accepted by its bytes and refused under a
renamed extension; every limit is refused with its exact Korean message
and nothing stored; images are re-encoded under 1,568 px with EXIF gone;
a CP949 CSV is decoded; the composer's estimate is the pre-check's figure;
a turn with a file charges what the mock reports; another member's file is
a 404; deleting a conversation removes the bytes; a file is never sent as
a Files API id.
"""

import base64
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import ChatAttachment, UsageEvent
from app.services import attachments as attachments_service
from app.services import chat as chat_service
from app.services.storage import get_storage


@pytest.fixture
def storage_settings(tmp_path):
    settings = Settings(app_env="development", storage_dir=str(tmp_path / "storage"), chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


# ------------------------------------------------------------- sample files


def jpeg_with_gps(width=3000, height=2000) -> bytes:
    image = Image.new("RGB", (width, height), (200, 30, 30))
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x8825] = {1: "N", 2: (37.0, 33.0, 0.0)}  # GPS
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def png(width=40, height=30) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (width, height), (0, 0, 255, 128)).save(out, format="PNG")
    return out.getvalue()


def gif() -> bytes:
    frames = [Image.new("P", (20, 20), i) for i in range(3)]
    out = io.BytesIO()
    frames[0].save(out, format="GIF", save_all=True, append_images=frames[1:])
    return out.getvalue()


def webp() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (50, 50), (0, 200, 0)).save(out, format="WEBP")
    return out.getvalue()


def pdf(pages=2, password: str | None = None) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    if password:
        writer.encrypt(password)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


CSV_TEXT = "이름,점수\n김유리,90\n박하늘,85\n"


def upload(client: TestClient, conversation_id: int, name: str, data: bytes):
    return client.post(
        f"/api/chat/conversations/{conversation_id}/attachments",
        params={"name": name},
        content=data,
        headers={"content-type": "application/octet-stream"},
    )


@pytest.fixture
def conversation(client: TestClient, budgeted, storage_settings) -> int:
    response = client.post("/api/chat/conversations", json={})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def stored_rows(db: Session) -> list[ChatAttachment]:
    return list(db.scalars(select(ChatAttachment)))


# ------------------------------------------------------------- accepted by their bytes


@pytest.mark.parametrize(
    ("name", "make", "kind"),
    [
        ("photo.jpg", lambda: jpeg_with_gps(800, 600), "image"),
        ("photo.png", png, "image"),
        ("moving.gif", gif, "image"),
        ("photo.webp", webp, "image"),
        ("report.pdf", lambda: pdf(3), "pdf"),
        ("scores.csv", lambda: CSV_TEXT.encode("utf-8"), "csv"),
        ("notes.md", lambda: "# 메모\n내용".encode("utf-8"), "text"),
        ("notes.txt", lambda: "그냥 글".encode("utf-8"), "text"),
    ],
)
def test_each_format_is_accepted_by_its_bytes(
    client: TestClient, conversation: int, db_session: Session, name, make, kind
) -> None:
    response = upload(client, conversation, name, make())
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["attachment"]["kind"] == kind
    assert body["attachment"]["name"] == name
    assert body["attachment"]["message_id"] is None
    assert body["estimate"]["tokens"] == body["attachment"]["estimated_tokens"] > 0
    assert len(stored_rows(db_session)) == 1


@pytest.mark.parametrize(
    ("name", "make"),
    [
        ("photo.pdf", png),  # an image renamed .pdf
        ("report.png", lambda: pdf(1)),  # a PDF renamed .png
        ("virus.exe", lambda: b"MZ\x90\x00binary"),
        ("data.csv", png),  # an image renamed .csv
        ("notes.txt", lambda: b"\x00\x01\x02\x03binary\x00"),  # binary named .txt
        ("photo.jpg", lambda: "그냥 글".encode("utf-8")),  # text named .jpg
    ],
)
def test_a_renamed_or_unknown_file_is_refused_and_nothing_stored(
    client: TestClient, conversation: int, db_session: Session, storage_settings, name, make
) -> None:
    response = upload(client, conversation, name, make())
    assert response.status_code == 400
    assert response.json()["detail"] == attachments_service.UNSUPPORTED
    assert stored_rows(db_session) == []
    root = get_storage(storage_settings).root
    assert not (root / "chat").exists()


# ------------------------------------------------------------- limits, refused with their message


def test_limits_are_refused_with_their_korean_message(
    client: TestClient, conversation: int, db_session: Session, storage_settings
) -> None:
    big_text = ("가" * (1024 * 1024)).encode("utf-8")  # 3 MB of text
    too_big = upload(client, conversation, "big.txt", big_text)
    assert too_big.status_code == 400
    assert too_big.json()["detail"] == "파일이 너무 큽니다 (최대 1MB)."

    long_pdf = upload(client, conversation, "long.pdf", pdf(31))
    assert long_pdf.json()["detail"] == "PDF가 너무 깁니다 (최대 30쪽)."

    locked = upload(client, conversation, "locked.pdf", pdf(1, password="secret"))
    assert locked.json()["detail"] == "암호가 걸린 PDF는 읽을 수 없습니다."

    assert stored_rows(db_session) == []


def test_an_upload_over_the_largest_limit_is_refused_without_reading_it_all(
    client: TestClient, conversation: int, db_session: Session
) -> None:
    response = upload(client, conversation, "huge.png", b"\x89PNG\r\n\x1a\n" + b"0" * (11 * 1024 * 1024))
    assert response.status_code == 413
    assert response.json()["detail"] == "파일이 너무 큽니다 (최대 10MB)."
    assert stored_rows(db_session) == []


def test_five_files_per_message(client: TestClient, conversation: int, db_session: Session) -> None:
    for index in range(5):
        assert upload(client, conversation, f"p{index}.png", png()).status_code == 201
    sixth = upload(client, conversation, "p5.png", png())
    assert sixth.status_code == 400
    assert sixth.json()["detail"] == "한 번에 5개까지 올릴 수 있습니다."
    assert len(stored_rows(db_session)) == 5


def test_the_member_quota_is_refused_and_nothing_stored(
    client: TestClient, conversation: int, db_session: Session, storage_settings, monkeypatch
) -> None:
    monkeypatch.setattr(storage_settings, "chat_attachment_member_quota_mb", 0)
    response = upload(client, conversation, "p.png", png())
    assert response.status_code == 409
    assert response.json()["detail"] == "첨부 공간이 가득 찼습니다 (지난 대화를 지우면 공간이 생깁니다)."
    assert stored_rows(db_session) == []


def test_the_server_limit_is_refused(
    client: TestClient, conversation: int, db_session: Session, storage_settings, monkeypatch
) -> None:
    monkeypatch.setattr(storage_settings, "chat_attachment_total_limit_gb", 0)
    response = upload(client, conversation, "p.png", png())
    assert response.status_code == 507
    assert stored_rows(db_session) == []


# ------------------------------------------------------------- what is stored


def test_images_are_reencoded_under_1568px_with_exif_gone(
    client: TestClient, conversation: int, db_session: Session, storage_settings
) -> None:
    original = jpeg_with_gps(3000, 2000)
    assert Image.open(io.BytesIO(original)).getexif()  # the sample does carry EXIF
    response = upload(client, conversation, "photo.jpg", original)
    body = response.json()["attachment"]
    assert (body["width"], body["height"]) == (1568, 1045)
    assert body["estimated_tokens"] == 56 * 38  # ceil(1568/28) × ceil(1045/28)

    row = stored_rows(db_session)[0]
    stored = get_storage(storage_settings).load(row.storage_key)
    image = Image.open(io.BytesIO(stored))
    assert max(image.size) <= 1568
    assert not image.getexif()
    assert row.storage_key == f"chat/{row.user_id}/{row.conversation_id}/{row.id}"


def test_a_cp949_csv_is_decoded(client: TestClient, conversation: int, db_session: Session, storage_settings) -> None:
    response = upload(client, conversation, "excel.csv", CSV_TEXT.encode("cp949"))
    assert response.status_code == 201, response.text
    row = stored_rows(db_session)[0]
    block = attachments_service.content_block(row, get_storage(storage_settings).load(row.storage_key))
    assert block["source"] == {"type": "text", "media_type": "text/plain", "data": CSV_TEXT}


# ------------------------------------------------------------- sending


def send(client: TestClient, conversation: int, content: str, ids: list[int]):
    return client.post(
        f"/api/chat/conversations/{conversation}/messages",
        json={"content": content, "attachment_ids": ids},
    )


def test_the_estimate_is_the_precheck_figure(
    client: TestClient, conversation: int, db_session: Session, storage_settings, monkeypatch
) -> None:
    first = upload(client, conversation, "photo.png", png(300, 200)).json()
    second = upload(client, conversation, "report.pdf", pdf(2)).json()
    estimate = client.get(f"/api/chat/conversations/{conversation}/attachments/estimate").json()
    assert estimate["tokens"] == first["attachment"]["estimated_tokens"] + second["attachment"]["estimated_tokens"]
    assert estimate["tokens"] == 11 * 8 + 2 * attachments_service.PDF_TOKENS_PER_PAGE
    assert estimate["with_files_krw"] > estimate["each_later_krw"] > 0

    seen: dict = {}
    real = chat_service.build_context

    def spy(*args, **kwargs):
        messages, estimated = real(*args, **kwargs)
        # The first call is the pre-check; the long-history warning after
        # the reply calls it again (token-guard).
        seen.setdefault("estimated", estimated)
        seen.setdefault("messages", messages)
        return messages, estimated

    monkeypatch.setattr(chat_service, "build_context", spy)
    response = send(client, conversation, "이 두 파일을 봐 줘", [first["attachment"]["id"], second["attachment"]["id"]])
    assert response.status_code == 200, response.text
    text_part = seen["estimated"] - estimate["tokens"]
    from app.services.claude_provider import CHAT_SYSTEM_PROMPT
    from app.services.pricing import estimate_tokens

    assert text_part == estimate_tokens(CHAT_SYSTEM_PROMPT) + estimate_tokens("이 두 파일을 봐 줘") + chat_service._MESSAGE_OVERHEAD


def test_a_turn_with_a_file_sends_blocks_and_charges_the_mocks_tokens(
    client: TestClient, conversation: int, db_session: Session
) -> None:
    uploaded = upload(client, conversation, "report.pdf", pdf(2)).json()["attachment"]
    response = send(client, conversation, "", [uploaded["id"]])
    assert response.status_code == 200, response.text
    assert "첨부한 파일(문서 1개)을 받았어요" in response.text

    event = db_session.scalar(select(UsageEvent))
    assert event is not None and event.charged_krw > 0
    billed = (event.input_tokens or 0) + (event.cache_write_tokens or 0) + (event.cache_read_tokens or 0)
    assert billed >= 2 * attachments_service.PDF_TOKENS_PER_PAGE

    row = db_session.get(ChatAttachment, uploaded["id"])
    db_session.refresh(row)
    assert row.message_id is not None
    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    sent = [m for m in detail["messages"] if m["role"] == "user"][0]
    assert [a["id"] for a in sent["attachments"]] == [uploaded["id"]]


def test_files_are_never_sent_as_a_files_api_id(
    client: TestClient, conversation: int, db_session: Session, monkeypatch
) -> None:
    captured: dict = {}
    from app.services.claude_provider import MockClaudeProvider

    real = MockClaudeProvider.stream_chat

    def spy(self, request):
        captured["messages"] = request.messages
        return real(self, request)

    monkeypatch.setattr(MockClaudeProvider, "stream_chat", spy)
    ids = [
        upload(client, conversation, "photo.png", png()).json()["attachment"]["id"],
        upload(client, conversation, "report.pdf", pdf(1)).json()["attachment"]["id"],
        upload(client, conversation, "scores.csv", CSV_TEXT.encode()).json()["attachment"]["id"],
    ]
    assert send(client, conversation, "봐 줘", ids).status_code == 200
    blocks = captured["messages"][-1]["content"]
    assert [block["type"] for block in blocks] == ["image", "document", "document", "text"]
    assert {block["source"]["type"] for block in blocks[:3]} <= {"base64", "text"}
    assert "file_id" not in json.dumps(blocks)
    assert base64.b64decode(blocks[0]["source"]["data"])[:8] == b"\x89PNG\r\n\x1a\n"


def test_files_stay_in_the_context_on_later_turns(
    client: TestClient, conversation: int, db_session: Session, monkeypatch
) -> None:
    captured: list = []
    from app.services.claude_provider import MockClaudeProvider

    real = MockClaudeProvider.stream_chat

    def spy(self, request):
        captured.append(request.messages)
        return real(self, request)

    monkeypatch.setattr(MockClaudeProvider, "stream_chat", spy)
    file_id = upload(client, conversation, "photo.png", png()).json()["attachment"]["id"]
    send(client, conversation, "첫 질문", [file_id])
    send(client, conversation, "다음 질문", [])
    first_user = captured[-1][0]
    assert isinstance(first_user["content"], list) and first_user["content"][0]["type"] == "image"


def test_a_file_already_sent_cannot_be_sent_again_or_removed(
    client: TestClient, conversation: int
) -> None:
    file_id = upload(client, conversation, "photo.png", png()).json()["attachment"]["id"]
    assert send(client, conversation, "봐 줘", [file_id]).status_code == 200
    again = send(client, conversation, "또", [file_id])
    assert again.status_code == 400
    assert client.delete(f"/api/chat/attachments/{file_id}").status_code == 409


def test_a_pending_file_can_be_removed(client: TestClient, conversation: int, db_session: Session, storage_settings) -> None:
    file_id = upload(client, conversation, "photo.png", png()).json()["attachment"]["id"]
    key = db_session.get(ChatAttachment, file_id).storage_key
    assert client.delete(f"/api/chat/attachments/{file_id}").status_code == 204
    assert stored_rows(db_session) == []
    assert not get_storage(storage_settings).exists(key)


# ------------------------------------------------------------- privacy and deleting


def test_another_members_file_is_a_404(
    client: TestClient, conversation: int, other_client_after, db_session: Session
) -> None:
    file_id = upload(client, conversation, "photo.png", png()).json()["attachment"]["id"]
    other = other_client_after()
    assert other.get(f"/api/chat/attachments/{file_id}/file").status_code == 404
    assert other.delete(f"/api/chat/attachments/{file_id}").status_code in (403, 404)
    assert upload(other, conversation, "x.png", png()).status_code in (403, 404)


@pytest.fixture
def other_client_after(db_session: Session, other_user):
    """A second browser signed in as another member (made on demand)."""
    from tests.conftest import MEMBER_PASSWORD

    def make() -> TestClient:
        other = TestClient(app)
        assert other.post(
            "/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}
        ).status_code == 200
        return other

    return make


def test_the_owner_downloads_their_file(client: TestClient, conversation: int) -> None:
    file_id = upload(client, conversation, "report.pdf", pdf(1)).json()["attachment"]["id"]
    response = client.get(f"/api/chat/attachments/{file_id}/file")
    assert response.status_code == 200
    assert response.content[:5] == b"%PDF-"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["x-content-type-options"] == "nosniff"
    image_id = upload(client, conversation, "p.png", png()).json()["attachment"]["id"]
    assert client.get(f"/api/chat/attachments/{image_id}/file").headers["content-disposition"].startswith("inline;")


def test_deleting_a_conversation_removes_the_bytes(
    client: TestClient, conversation: int, db_session: Session, storage_settings
) -> None:
    sent = upload(client, conversation, "photo.png", png()).json()["attachment"]["id"]
    send(client, conversation, "봐 줘", [sent])
    pending = upload(client, conversation, "later.png", png()).json()["attachment"]["id"]
    keys = [db_session.get(ChatAttachment, i).storage_key for i in (sent, pending)]
    assert client.delete(f"/api/chat/conversations/{conversation}").status_code == 204
    db_session.expire_all()
    assert stored_rows(db_session) == []
    storage = get_storage(storage_settings)
    assert not any(storage.exists(key) for key in keys)


def test_anonymising_a_member_deletes_their_files(
    client: TestClient, conversation: int, db_session: Session, storage_settings, dev_user
) -> None:
    file_id = upload(client, conversation, "photo.png", png()).json()["attachment"]["id"]
    key = db_session.get(ChatAttachment, file_id).storage_key
    storage = get_storage(storage_settings)
    assert storage.exists(key)
    removed = attachments_service.delete_for_user(db_session, storage, dev_user.id)
    db_session.commit()
    assert removed == 1
    assert stored_rows(db_session) == []
    assert not storage.exists(key)


def test_a_member_not_taking_part_still_downloads_but_cannot_upload(
    client: TestClient, conversation: int, db_session: Session, dev_user, participating
) -> None:
    from app.models import MembershipStatus
    from app.services.quarters import set_membership

    file_id = upload(client, conversation, "report.pdf", pdf(1)).json()["attachment"]["id"]
    set_membership(db_session, dev_user.id, participating.id, MembershipStatus.INACTIVE)
    db_session.commit()
    assert client.get(f"/api/chat/attachments/{file_id}/file").status_code == 200
    assert upload(client, conversation, "p.png", png()).status_code == 403


def test_the_mock_bills_attachments_with_the_estimate_formulas() -> None:
    image_block = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(png(56, 28)).decode()}}
    pdf_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(pdf(3)).decode()}}
    text_block = {"type": "document", "source": {"type": "text", "media_type": "text/plain", "data": "가나다"}}
    assert attachments_service.block_tokens(image_block) == 2 * 1
    assert attachments_service.block_tokens(pdf_block) == 3 * attachments_service.PDF_TOKENS_PER_PAGE
    assert attachments_service.block_tokens(text_block) == 3


def test_files_in_the_window_count_toward_the_long_history_warning(
    client: TestClient, conversation: int, db_session: Session, storage_settings, monkeypatch
) -> None:
    """A conversation carrying a PDF is "long" by its pages, not only its text."""
    from dataclasses import replace

    from app.models import Conversation
    from app.services import chat_limits, chat_models

    pdf_upload = upload(client, conversation, "report.pdf", pdf(2)).json()
    assert send(client, conversation, "요약해 줘", [pdf_upload["attachment"]["id"]]).status_code == 200

    real = chat_limits.current
    monkeypatch.setattr(chat_limits, "current", lambda db: replace(real(db), long_history_tokens=1))
    chat = db_session.get(Conversation, conversation)
    history = chat_service.messages_of(db_session, chat)
    model = chat_models.default_model(db_session, storage_settings)
    warning = chat_service.long_history_info(db_session, storage_settings, history, model)

    text_only = sum(
        chat_service.estimate_tokens(m.content) + chat_service._MESSAGE_OVERHEAD for m in history
    )
    assert warning is not None
    assert warning.history_tokens >= 2 * attachments_service.PDF_TOKENS_PER_PAGE
    assert warning.history_tokens > text_only


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", None]
)
def test_an_upload_a_page_could_send_without_a_preflight_is_refused(
    client: TestClient, conversation: int, db_session: Session, content_type
) -> None:
    """A member app on apps.ctrlai.my is same-site: a "simple" cross-origin
    POST would carry the session cookie with no CORS preflight (CLAUDE.md §2)."""
    headers = {"content-type": content_type} if content_type else {}
    response = client.post(
        f"/api/chat/conversations/{conversation}/attachments",
        params={"name": "note.txt"},
        content=b"hello",
        headers=headers,
    )
    assert response.status_code == 415
    assert db_session.query(ChatAttachment).count() == 0
