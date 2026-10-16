"""Screenshots on 의견 보내기 (feedback-screenshots).

A member may attach up to `FEEDBACK_IMAGES_PER_NOTE` images to one note —
PNG, JPEG or WebP, each at most `FEEDBACK_IMAGE_MAX_MB` (the route reads
no more than that). The checks are Chat's (`attachments.reencode_image`):
the kind is read from the bytes, the extension must agree, the image is
decoded under the pixel guard and encoded again without its metadata.
The long edge is larger than Chat's: a screenshot is read by a person,
not sent to a model, and its text must stay legible.

**Nothing is stored until every check has passed**, and over a limit the
upload is refused with a Korean sentence. Stored bytes count against a
per-member quota and the server total Chat attachments share.

Who may read a stored image: an admin, from Admin › Feedback. There is
no member route — not even the uploader's own.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import FeedbackImage
from app.services.attachments import MB, AttachmentRefusal, Checked, delete_all_of, delete_bytes, extension, reencode_image, sniff
from app.services import attachments as attachments_service
from app.services.storage import AssetStorage

__all__ = ["delete_bytes"]

#: Screenshots of a 1440-wide screen keep their text at this size.
LONG_EDGE = 2560

#: A waiting picture older than this, found when the member is already
#: at the cap, was left behind by a dialog that never closed properly
#: (tab closed, browser crashed): it is swept so it cannot block them. A
#: day, not an hour — a dialog kept open while a long note is written
#: must not lose the picture it still shows.
ABANDONED_AFTER = timedelta(hours=24)

ALLOWED = {"png": ("png",), "jpeg": ("jpg", "jpeg"), "webp": ("webp",)}

UNSUPPORTED = "PNG, JPG, WebP 이미지만 올릴 수 있어요."
NOT_YOURS = "사진을 찾을 수 없어요. 다시 붙여 주세요."
ALREADY_SENT = "이미 보낸 의견의 사진은 뺄 수 없어요."
QUOTA_FULL = "의견 사진 공간이 가득 찼어요. 운영진이 지난 의견을 정리한 뒤 다시 올릴 수 있어요."


def too_many(limit: int) -> str:
    return f"사진은 {limit}장까지 붙일 수 있어요."


def too_big(limit_mb: int) -> str:
    return f"사진이 너무 커요 (1장 {limit_mb}MB 이하)."


def check_image(name: str, data: bytes) -> Checked:
    """One screenshot's bytes → the re-encoded copy. Raises `AttachmentRefusal`.

    The size limit is the route's: it stops reading past it (413) before
    these bytes exist.
    """
    found = sniff(data)
    if found not in ALLOWED or extension(name) not in ALLOWED[found]:
        raise AttachmentRefusal(UNSUPPORTED)
    return reencode_image(data, long_edge=LONG_EDGE)


def storage_key(row: FeedbackImage) -> str:
    return f"feedback/{row.user_id}/{row.id}"


def pending_for(db: Session, user_id: int) -> list[FeedbackImage]:
    """Uploaded by this member, not attached to a note yet."""
    return list(
        db.scalars(
            select(FeedbackImage)
            .where(FeedbackImage.user_id == user_id, FeedbackImage.feedback_id.is_(None))
            .order_by(FeedbackImage.id)
        )
    )


def member_bytes(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.coalesce(func.sum(FeedbackImage.stored_size), 0)).where(FeedbackImage.user_id == user_id)
    ) or 0


def total_bytes(db: Session) -> int:
    """Every feedback screenshot on this server — part of Admin's figure."""
    return db.scalar(select(func.coalesce(func.sum(FeedbackImage.stored_size), 0))) or 0


def check_room(db: Session, user_id: int, checked: Checked, settings: Settings) -> None:
    """Member quota and the server total (shared with Chat). Raises."""
    if member_bytes(db, user_id) + len(checked.data) > settings.feedback_image_member_quota_mb * MB:
        raise AttachmentRefusal(QUOTA_FULL, status_code=409)
    stored = attachments_service.total_bytes(db) + total_bytes(db)
    if stored + len(checked.data) > settings.chat_attachment_total_limit_gb * 1024 * MB:
        raise AttachmentRefusal(attachments_service.SERVER_FULL, status_code=507)


def sweep_abandoned(db: Session, user_id: int, now: datetime | None = None) -> list[str]:
    """Delete this member's waiting pictures older than `ABANDONED_AFTER`
    (rows, not committed). Returns the keys to delete after the commit.

    Called only when the member is at the cap — the one case where a
    leftover can block them — so a picture still shown in an open dialog
    is never taken away under it.
    """
    cutoff = (now or datetime.now(timezone.utc)) - ABANDONED_AFTER
    stale = [
        row
        for row in pending_for(db, user_id)
        if row.created_at is not None and _aware(row.created_at) < cutoff
    ]
    return delete_rows(db, stale)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def delete_rows(db: Session, rows: list[FeedbackImage]) -> list[str]:
    """Delete the rows (not committed); return the keys to delete after the commit."""
    keys = [row.storage_key for row in rows]
    for row in rows:
        db.delete(row)
    return keys


def delete_for_user(db: Session, storage: AssetStorage, user_id: int) -> int:
    """Every screenshot a member uploaded — rows (not committed) and bytes.

    Withdrawal anonymisation: the notes stay, the pictures go. Returns how
    many there were.
    """
    return delete_all_of(db, storage, FeedbackImage, user_id)
