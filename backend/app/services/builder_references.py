"""Reference pictures for 만들기 / 고치기 (builder-images (1)).

The owner, 2026-10-17: "빌더에는 사진 추가 못하나..? 이런 디자인 참고 등으로".
A member drops or pastes up to `MAX_PER_REQUEST` pictures into the
Builder's request box; the next plan takes every waiting picture of the
project and keeps it for that run, so the plan call and each file call
**see** it (vision input) and follow its look — colours, layout, type,
spacing. A picture is never written into the app (that is builder-images
(2), app assets).

The upload path is Chat's (chat-plus-files) and 의견 보내기's: the kind is
read from the bytes, the picture decoded under the pixel guard and
re-encoded at `LONG_EDGE` with no metadata kept — phone photos carry GPS.
`LONG_EDGE` is smaller than Chat's because a picture rides along with
every file call of the run: 1024 px is about 1,400 tokens (a few 원 per
call), enough for Claude to read a layout.
"""

from __future__ import annotations

import base64

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderGeneration, BuilderProject, BuilderReference, User
from app.services.attachments import (
    MB,
    AttachmentRefusal,
    Checked,
    delete_all_of,
    delete_bytes,
    image_tokens,
    reencode_image,
    sniff,
)
from app.services.storage import AssetStorage

#: Pictures one request may carry.
MAX_PER_REQUEST = 3
#: The stored copy's long edge (see the module docstring).
LONG_EDGE = 1024
#: All of one member's reference pictures together.
MEMBER_QUOTA_MB = 50

UNSUPPORTED = "PNG, JPG, WebP, GIF 사진만 올릴 수 있어요."
TOO_MANY = f"참고 사진은 한 번에 {MAX_PER_REQUEST}장까지 붙일 수 있어요."
QUOTA_FULL = "참고 사진 공간이 가득 찼어요. 지난 프로젝트를 지우면 공간이 생겨요."
NOT_FOUND = "사진을 찾을 수 없어요."


def too_big(limit_mb: int) -> str:
    return f"사진이 너무 커요 (1장 {limit_mb}MB 이하)."


def storage_key(row: BuilderReference) -> str:
    return f"builder-ref/{row.project_id}/{row.id}"


def check(data: bytes, settings: Settings) -> Checked:
    """The bytes decide the kind; re-encoded at `LONG_EDGE`. Raises `AttachmentRefusal`."""
    if sniff(data) not in ("jpeg", "png", "gif", "webp"):
        raise AttachmentRefusal(UNSUPPORTED)
    if len(data) > settings.chat_attachment_image_max_mb * MB:
        raise AttachmentRefusal(too_big(settings.chat_attachment_image_max_mb))
    return reencode_image(data, LONG_EDGE)


def pending(db: Session, project: BuilderProject) -> list[BuilderReference]:
    """Waiting in the request box (not yet taken by a plan), oldest first."""
    return list(
        db.scalars(
            select(BuilderReference)
            .where(BuilderReference.project_id == project.id, BuilderReference.generation_id.is_(None))
            .order_by(BuilderReference.id)
        )
    )


def of_generation(db: Session, generation: BuilderGeneration) -> list[BuilderReference]:
    return list(
        db.scalars(
            select(BuilderReference)
            .where(BuilderReference.generation_id == generation.id)
            .order_by(BuilderReference.id)
        )
    )


def member_bytes(db: Session, user_id: int) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(BuilderReference.stored_size), 0)).where(
                BuilderReference.user_id == user_id
            )
        )
        or 0
    )


def add(
    db: Session,
    storage: AssetStorage,
    settings: Settings,
    *,
    user: User,
    project: BuilderProject,
    data: bytes,
    name: str,
) -> BuilderReference:
    """Check, store and record one picture. Does not commit. Raises `AttachmentRefusal`."""
    if len(pending(db, project)) >= MAX_PER_REQUEST:
        raise AttachmentRefusal(TOO_MANY)
    checked = check(data, settings)
    if member_bytes(db, user.id) + len(checked.data) > MEMBER_QUOTA_MB * MB:
        raise AttachmentRefusal(QUOTA_FULL, status_code=409)
    row = BuilderReference(
        project_id=project.id,
        user_id=user.id,
        media_type=checked.media_type,
        original_name=name[:255],
        stored_size=len(checked.data),
        width=checked.width or 0,
        height=checked.height or 0,
    )
    db.add(row)
    db.flush()
    row.storage_key = storage_key(row)
    storage.save(row.storage_key, checked.data)
    return row


def remove(db: Session, storage: AssetStorage, row: BuilderReference) -> None:
    """✕ in the request box: a waiting picture only. Does not commit."""
    if row.generation_id is not None:
        raise AttachmentRefusal("이미 보낸 요청의 사진은 뺄 수 없어요.", status_code=409)
    key = row.storage_key
    db.delete(row)
    db.flush()
    delete_bytes(storage, [key])


def take_for(db: Session, project: BuilderProject, generation: BuilderGeneration) -> list[BuilderReference]:
    """The plan keeps the waiting pictures for its run."""
    rows = pending(db, project)[:MAX_PER_REQUEST]
    for row in rows:
        row.generation_id = generation.id
    return rows


def tokens(rows: list[BuilderReference]) -> int:
    """What the pictures add to one call's input — the API's own estimate
    for an image (`image_tokens`), so the pre-check and the mock agree."""
    return sum(image_tokens(row.width, row.height) for row in rows)


def blocks(storage: AssetStorage, rows: list[BuilderReference]) -> list[dict]:
    """The image blocks sent with a call — the bytes themselves, base64,
    never a Files API id (those are workspace-wide). A picture whose file
    is gone is skipped rather than failing the run."""
    out: list[dict] = []
    for row in rows:
        try:
            data = storage.load(row.storage_key)
        except (OSError, ValueError):
            continue
        out.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": row.media_type, "data": base64.b64encode(data).decode("ascii")},
            }
        )
    return out


def storage_keys(db: Session, project_id: int) -> list[str]:
    """For the purge's clean-up on disk."""
    return [
        key
        for key in db.scalars(select(BuilderReference.storage_key).where(BuilderReference.project_id == project_id))
        if key
    ]


def delete_for_user(db: Session, storage: AssetStorage, user_id: int) -> int:
    """Withdrawal anonymisation: a member's pictures, rows and bytes."""
    return delete_all_of(db, storage, BuilderReference, user_id)
