"""Pictures that are part of the app (builder-images (2)).

The owner, 2026-10-17: "빌더 사진: 앱에 넣는 사진(로고 등)". A member adds a
picture to the project; it lives at `images/<name>.<ext>`, is written into
the app's folder beside the text files (so `<img src="images/logo.png">`
works on apps.<domain>, in the Builder preview and in server thumbnails),
is packed into the ZIP, and is named to Claude in every 만들기 / 고치기 so
the app can use it.

Checked like every upload: the kind from the bytes, decoded under the
pixel guard, re-encoded at `LONG_EDGE` with no metadata. Assets are the
project's, not a version's — 되돌리기 brings back files, not pictures.
"""

from __future__ import annotations

import posixpath
import re
import unicodedata

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderAsset, BuilderProject, User
from app.services.attachments import MB, AttachmentRefusal, delete_bytes, reencode_image, sniff
from app.services.storage import AssetStorage

#: A logo or a photo in an app: big enough for a full-width header.
LONG_EDGE = 1600
#: Pictures one project may hold, each and together (the app folder's
#: own limit is `builder_files.MAX_PROJECT_BYTES` for text).
MAX_ASSETS = 10
MAX_ASSET_BYTES = 1 * MB
MAX_TOTAL_BYTES = 5 * MB
FOLDER = "images"

EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}

UNSUPPORTED = "PNG, JPG, WebP, GIF 사진만 앱에 넣을 수 있어요."
TOO_MANY = f"앱에 넣는 사진은 {MAX_ASSETS}장까지예요. 쓰지 않는 사진을 빼 주세요."
TOO_BIG = "사진이 너무 커요. 줄인 뒤에도 1MB가 넘어요 — 더 작은 사진을 써 주세요."
FULL = "앱에 넣은 사진이 모두 5MB를 넘어요. 쓰지 않는 사진을 빼 주세요."
NOT_FOUND = "사진을 찾을 수 없어요."


def storage_key(row: BuilderAsset) -> str:
    return f"builder-asset/{row.project_id}/{row.id}"


def listed(db: Session, project: BuilderProject) -> list[BuilderAsset]:
    return list(
        db.scalars(select(BuilderAsset).where(BuilderAsset.project_id == project.id).order_by(BuilderAsset.path))
    )


def _stem(name: str) -> str:
    """A safe file name from what the member called it: lower-case
    letters, digits and dashes (Hangul kept), else "image"."""
    stem = posixpath.splitext(posixpath.basename(name.replace("\\", "/")))[0]
    stem = unicodedata.normalize("NFC", stem).strip().lower()
    stem = re.sub(r"[^\w가-힣-]+", "-", stem, flags=re.UNICODE).strip("-_")
    return stem[:40] or "image"


def path_for(db: Session, project: BuilderProject, name: str, media_type: str) -> str:
    """`images/<stem><ext>`, with -2, -3 … when taken."""
    ext = EXTENSIONS[media_type]
    stem = _stem(name)
    taken = {row.path for row in listed(db, project)}
    candidate = f"{FOLDER}/{stem}{ext}"
    number = 2
    while candidate in taken:
        candidate = f"{FOLDER}/{stem}-{number}{ext}"
        number += 1
    return candidate


def add(
    db: Session,
    storage: AssetStorage,
    settings: Settings,
    *,
    user: User,
    project: BuilderProject,
    data: bytes,
    name: str,
) -> BuilderAsset:
    """Check, store and record one picture. Does not commit. Raises `AttachmentRefusal`.

    The project row is locked first, so two uploads at once cannot both
    pass the limits or pick the same path (PostgreSQL; the unique
    constraint is the last word either way)."""
    db.execute(select(BuilderProject.id).where(BuilderProject.id == project.id).with_for_update())
    if sniff(data) not in ("jpeg", "png", "gif", "webp"):
        raise AttachmentRefusal(UNSUPPORTED)
    if len(data) > settings.chat_attachment_image_max_mb * MB:
        raise AttachmentRefusal(f"사진이 너무 커요 (1장 {settings.chat_attachment_image_max_mb}MB 이하).")
    rows = listed(db, project)
    if len(rows) >= MAX_ASSETS:
        raise AttachmentRefusal(TOO_MANY)
    checked = reencode_image(data, LONG_EDGE)
    if len(checked.data) > MAX_ASSET_BYTES:
        raise AttachmentRefusal(TOO_BIG)
    if sum(row.stored_size for row in rows) + len(checked.data) > MAX_TOTAL_BYTES:
        raise AttachmentRefusal(FULL, status_code=409)
    row = BuilderAsset(
        project_id=project.id,
        user_id=user.id,
        path=path_for(db, project, name, checked.media_type),
        media_type=checked.media_type,
        stored_size=len(checked.data),
        width=checked.width or 0,
        height=checked.height or 0,
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError as error:
        raise AttachmentRefusal("같은 이름의 사진을 동시에 올렸어요. 다시 한 번 올려 주세요.", status_code=409) from error
    row.storage_key = storage_key(row)
    storage.save(row.storage_key, checked.data)
    return row


def remove(db: Session, storage: AssetStorage, row: BuilderAsset) -> None:
    """Does not commit."""
    key = row.storage_key
    db.delete(row)
    db.flush()
    delete_bytes(storage, [key])


def contents(db: Session, storage: AssetStorage, project: BuilderProject) -> dict[str, bytes]:
    """`path → bytes` for the app folder and the ZIP. A picture whose file
    is gone is left out rather than failing the write."""
    out: dict[str, bytes] = {}
    for row in listed(db, project):
        try:
            out[row.path] = storage.load(row.storage_key)
        except (OSError, ValueError):
            continue
    return out


def note(db: Session, project: BuilderProject) -> str:
    """What Claude is told about the pictures (empty when there are none):
    their paths and sizes, that the app may show them, and that they are
    not text files to write."""
    rows = listed(db, project)
    if not rows:
        return ""
    lines = [f"- {row.path} ({row.width}×{row.height})" for row in rows]
    return (
        "\n\n앱에 넣은 사진 (이미 있는 파일 — 그대로 쓸 수 있고, 새로 쓰거나 고치지 마세요. "
        'HTML에서는 <img src="경로">, CSS에서는 url("경로")로 씁니다):\n' + "\n".join(lines)
    )


def total_bytes(db: Session, project_id: int) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(BuilderAsset.stored_size), 0)).where(BuilderAsset.project_id == project_id)
        )
        or 0
    )


def storage_keys(db: Session, project_id: int) -> list[str]:
    return [
        key for key in db.scalars(select(BuilderAsset.storage_key).where(BuilderAsset.project_id == project_id)) if key
    ]
