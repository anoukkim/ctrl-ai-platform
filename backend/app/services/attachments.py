"""Chat attachments: checking, storing and sending files (chat-plus-files).

What may be attached, per message, up to five files:

| Kind  | Formats                    | Limit            | Sent to Claude as |
| ----- | -------------------------- | ---------------- | ----------------- |
| image | JPEG, PNG, WebP, GIF (1st frame) | 10 MB      | `image` block, re-encoded to a long edge of at most 1,568 px |
| pdf   | PDF, not encrypted         | 10 MB, 30 pages  | `document` block (base64) |
| csv   | CSV                        | 1 MB             | text, in a `document` block |
| text  | TXT, MD                    | 1 MB             | text, in a `document` block |

**The kind is decided from the bytes** — magic numbers, and pypdf opening
the PDF — never from the extension. The extension must then agree with
the bytes: a renamed file is refused rather than guessed at. CSV and text
are decoded as UTF-8, falling back to CP949 (Korean Excel exports).

**A file over a limit is refused, never truncated.** Nothing is stored
until every check has passed.

Nothing but Pillow and pypdf ever opens a member's file, both under size
limits, and nothing is executed. Re-encoding an image drops its EXIF —
phone photos carry GPS.

**Token estimates** are the same here, in the browser (which receives
`estimated_tokens`) and in the budget pre-check:

* image: `ceil(w/28) × ceil(h/28)` after the resize;
* PDF: pages × 3,000 (text) + pages × 1,600 (page image) — the upper end
  of the documented range until real Korean PDFs are measured;
* CSV and text: one token per character, like messages.

The mock Claude provider bills attachment blocks with `block_tokens`, the
same formulas read back from the blocks themselves.
"""

from __future__ import annotations

import base64
import io
import math
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import AttachmentKind, ChatAttachment
from app.services.pricing import estimate_tokens

MB = 1024 * 1024

#: Claude's own guidance: larger images are scaled down on its side anyway,
#: so sending more pixels only costs more.
IMAGE_LONG_EDGE = 1568
#: Pillow refuses to decode beyond this many pixels (a decompression bomb
#: guard). 50 MP is above any phone camera.
MAX_IMAGE_PIXELS = 50_000_000
PDF_TOKENS_PER_PAGE = 3_000 + 1_600

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}
TEXT_EXTENSIONS = {"txt", "md", "markdown"}
CSV_EXTENSIONS = {"csv"}

UNSUPPORTED = "지원하지 않는 형식입니다 (JPEG, PNG, WebP, GIF, PDF, CSV, TXT, MD만 올릴 수 있습니다)."
TOO_MANY = "한 번에 5개까지 올릴 수 있습니다."
PDF_TOO_LONG = "PDF가 너무 깁니다 (최대 {pages}쪽)."
PDF_ENCRYPTED = "암호가 걸린 PDF는 읽을 수 없습니다."
QUOTA_FULL = "첨부 공간이 가득 찼습니다 (지난 대화를 지우면 공간이 생깁니다)."
SERVER_FULL = "지금은 서버의 첨부 공간이 가득 차서 올릴 수 없습니다. 관리자에게 알려 주세요."
TOO_BIG_FOR_ONE_MESSAGE = (
    "이 메시지에 붙인 파일이 한 번에 보내기에 너무 깁니다. 몇 개는 다음 메시지로 나누어 보내 주세요."
)
BROKEN = "파일을 열 수 없습니다. 손상되었거나 다른 형식일 수 있습니다."


def too_big(limit_mb: int) -> str:
    return f"파일이 너무 큽니다 (최대 {limit_mb}MB)."


class AttachmentRefusal(Exception):
    """A file that may not be attached. Korean message, HTTP status attached."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class Checked:
    """A file that passed every check, ready to store."""

    kind: AttachmentKind
    media_type: str
    data: bytes
    page_count: int | None = None
    width: int | None = None
    height: int | None = None
    estimated_tokens: int = 0


# ------------------------------------------------------------- what is it


def extension(name: str) -> str:
    """The lower-cased extension, without the dot; "" when there is none."""
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def sniff(data: bytes) -> str | None:
    """The format the bytes say they are: jpeg, png, gif, webp, pdf, or None."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data.lstrip(b"\x00\t\r\n ")[:5] == b"%PDF-":
        return "pdf"
    return None


def decode_text(data: bytes) -> str | None:
    """UTF-8 (with or without a BOM), else CP949; None if neither, or not text."""
    for encoding in ("utf-8-sig", "cp949"):
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        # Text, not a binary file that happened to decode: no NUL bytes and
        # almost no other control characters.
        controls = sum(1 for ch in text if ord(ch) < 32 and ch not in "\t\r\n\f")
        if "\x00" in text or controls > max(2, len(text) // 200):
            return None
        return text
    return None


# ------------------------------------------------------------- the checks


def _image(data: bytes, settings: Settings) -> Checked:
    """A Chat image: re-encoded to Chat's long edge (`IMAGE_LONG_EDGE`)."""
    return reencode_image(data)


def reencode_image(data: bytes, long_edge: int = IMAGE_LONG_EDGE) -> Checked:
    """Decode, drop the metadata, scale to `long_edge` and encode again.

    Shared by Chat (chat-plus-files), app AI (app-platform) and the
    screenshots on 의견 보내기 (feedback-screenshots): the same decoder
    under the same pixel guard, and never a byte of EXIF kept — phone
    photos carry GPS.
    """
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as source:
            fmt = (source.format or "").upper()
            source.seek(0)  # a GIF's first frame
            image = ImageOps.exif_transpose(source) or source
            image.load()
            if image.mode not in ("RGB", "RGBA", "L", "LA"):
                image = image.convert("RGBA" if "transparency" in image.info or image.mode == "P" else "RGB")
            image.thumbnail((long_edge, long_edge))
            out = io.BytesIO()
            if fmt == "JPEG":
                if image.mode not in ("RGB", "L"):
                    image = image.convert("RGB")
                # No `exif=` argument: the metadata is not copied.
                image.save(out, format="JPEG", quality=85, optimize=True)
                media_type = "image/jpeg"
            elif fmt == "WEBP":
                image.save(out, format="WEBP", quality=85)
                media_type = "image/webp"
            else:  # PNG, and a GIF's first frame
                image.save(out, format="PNG", optimize=True)
                media_type = "image/png"
            width, height = image.size
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as error:
        raise AttachmentRefusal(BROKEN) from error
    return Checked(
        kind=AttachmentKind.IMAGE,
        media_type=media_type,
        data=out.getvalue(),
        width=width,
        height=height,
        estimated_tokens=image_tokens(width, height),
    )


def _pdf(data: bytes, settings: Settings) -> Checked:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise AttachmentRefusal(PDF_ENCRYPTED)
        pages = len(reader.pages)
    except AttachmentRefusal:
        raise
    except (PdfReadError, OSError, ValueError, KeyError, TypeError) as error:
        raise AttachmentRefusal(BROKEN) from error
    if pages > settings.chat_attachment_pdf_max_pages:
        raise AttachmentRefusal(PDF_TOO_LONG.format(pages=settings.chat_attachment_pdf_max_pages))
    if pages == 0:
        raise AttachmentRefusal(BROKEN)
    return Checked(
        kind=AttachmentKind.PDF,
        media_type="application/pdf",
        data=data,
        page_count=pages,
        estimated_tokens=pages * PDF_TOKENS_PER_PAGE,
    )


def check_file(name: str, data: bytes, settings: Settings) -> Checked:
    """Every check on one file's bytes. Raises `AttachmentRefusal`."""
    ext = extension(name)
    found = sniff(data)

    if found in ("jpeg", "png", "gif", "webp"):
        if ext not in IMAGE_EXTENSIONS:
            raise AttachmentRefusal(UNSUPPORTED)
        if len(data) > settings.chat_attachment_image_max_mb * MB:
            raise AttachmentRefusal(too_big(settings.chat_attachment_image_max_mb))
        return _image(data, settings)

    if found == "pdf":
        if ext != "pdf":
            raise AttachmentRefusal(UNSUPPORTED)
        if len(data) > settings.chat_attachment_pdf_max_mb * MB:
            raise AttachmentRefusal(too_big(settings.chat_attachment_pdf_max_mb))
        return _pdf(data, settings)

    # Not an image or a PDF by its bytes: it may only be text.
    if ext not in CSV_EXTENSIONS | TEXT_EXTENSIONS:
        raise AttachmentRefusal(UNSUPPORTED)
    if len(data) > settings.chat_attachment_text_max_mb * MB:
        raise AttachmentRefusal(too_big(settings.chat_attachment_text_max_mb))
    text = decode_text(data)
    if text is None or not text.strip():
        raise AttachmentRefusal(UNSUPPORTED if text is None else BROKEN)
    kind = AttachmentKind.CSV if ext in CSV_EXTENSIONS else AttachmentKind.TEXT
    return Checked(
        kind=kind,
        media_type="text/csv" if kind is AttachmentKind.CSV else "text/plain",
        data=data,
        estimated_tokens=estimate_tokens(text),
    )


def image_tokens(width: int, height: int) -> int:
    return math.ceil(width / 28) * math.ceil(height / 28)


# ------------------------------------------------------------- limits around a file


def pending_for(db: Session, user_id: int, conversation_id: int) -> list[ChatAttachment]:
    """Uploaded to this conversation, not yet sent with a message."""
    return list(
        db.scalars(
            select(ChatAttachment)
            .where(
                ChatAttachment.user_id == user_id,
                ChatAttachment.conversation_id == conversation_id,
                ChatAttachment.message_id.is_(None),
            )
            .order_by(ChatAttachment.id)
        )
    )


def member_bytes(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.coalesce(func.sum(ChatAttachment.stored_size), 0)).where(
            ChatAttachment.user_id == user_id
        )
    ) or 0


def total_bytes(db: Session) -> int:
    """Every attachment on this server — what Admin's dashboard shows."""
    return db.scalar(select(func.coalesce(func.sum(ChatAttachment.stored_size), 0))) or 0


def check_room(db: Session, user_id: int, conversation_id: int, checked: Checked, settings: Settings) -> None:
    """Count, per-message size, member quota and server limit. Raises."""
    pending = pending_for(db, user_id, conversation_id)
    if len(pending) >= settings.chat_attachments_per_message:
        raise AttachmentRefusal(TOO_MANY)
    if sum(row.estimated_tokens for row in pending) + checked.estimated_tokens > settings.chat_attachment_context_tokens:
        raise AttachmentRefusal(TOO_BIG_FOR_ONE_MESSAGE)
    if member_bytes(db, user_id) + len(checked.data) > settings.chat_attachment_member_quota_mb * MB:
        raise AttachmentRefusal(QUOTA_FULL, status_code=409)
    if total_bytes(db) + len(checked.data) > settings.chat_attachment_total_limit_gb * 1024 * MB:
        raise AttachmentRefusal(SERVER_FULL, status_code=507)


def storage_key(row: ChatAttachment) -> str:
    return f"chat/{row.user_id}/{row.conversation_id}/{row.id}"


def delete_bytes(storage, keys: list[str]) -> None:
    """Remove stored files. Best effort: a file already gone is fine."""
    for key in keys:
        if not key:
            continue
        try:
            storage.delete(key)
        except OSError:
            pass


def delete_all_of(db: Session, storage, model, user_id: int) -> int:
    """Every stored file of a member in `model` (a table with `user_id` and
    `storage_key`) — rows (not committed) and bytes. Returns how many."""
    from sqlalchemy import delete as sql_delete

    rows = list(db.scalars(select(model).where(model.user_id == user_id)))
    keys = [row.storage_key for row in rows]
    db.execute(
        sql_delete(model).where(model.user_id == user_id).execution_options(synchronize_session=False)
    )
    delete_bytes(storage, keys)
    return len(rows)


def delete_for_user(db: Session, storage, user_id: int) -> int:
    """Every attachment of a member — rows (not committed) and bytes.

    Withdrawal anonymisation. Returns how many there were.
    """
    return delete_all_of(db, storage, ChatAttachment, user_id)


# ------------------------------------------------------------- what Claude receives


def content_block(row: ChatAttachment, data: bytes) -> dict:
    """The block sent for one attachment. Always the bytes themselves —
    base64 or text — never a Files API id: those ids are workspace-wide,
    and the uploads cannot be downloaded again."""
    if row.kind is AttachmentKind.IMAGE:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": row.media_type,
                "data": base64.b64encode(data).decode("ascii"),
            },
        }
    if row.kind is AttachmentKind.PDF:
        return {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.b64encode(data).decode("ascii"),
            },
            "title": row.original_name,
        }
    return {
        "type": "document",
        "source": {"type": "text", "media_type": "text/plain", "data": decode_text(data) or ""},
        "title": row.original_name,
    }


def block_tokens(block: dict) -> int:
    """The estimate for one content block, read back from the block — what
    the mock provider bills, so tests see the same figures as the pre-check."""
    kind = block.get("type")
    if kind == "text":
        return estimate_tokens(block.get("text", ""))
    source = block.get("source") or {}
    if kind == "image":
        from PIL import Image

        with Image.open(io.BytesIO(base64.b64decode(source.get("data", "")))) as image:
            return image_tokens(*image.size)
    if kind == "document" and source.get("type") == "base64":
        from pypdf import PdfReader

        pages = len(PdfReader(io.BytesIO(base64.b64decode(source.get("data", "")))).pages)
        return pages * PDF_TOKENS_PER_PAGE
    if kind == "document":
        return estimate_tokens(source.get("data", ""))
    return 0


def content_tokens(content: str | list[dict]) -> int:
    """A message's estimate, whether it is plain text or blocks."""
    if isinstance(content, str):
        return estimate_tokens(content)
    return sum(block_tokens(block) for block in content)
