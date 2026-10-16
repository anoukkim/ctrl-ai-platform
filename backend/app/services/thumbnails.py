"""App thumbnails (ui-improvements — owner-polish 4·5).

A thumbnail is a picture of the app **taken in the maker's own browser**:
the SDK inside the sandboxed app frame draws the page (DOM → SVG → canvas),
the shell relays it to the site, and the Builder page uploads the bytes
here. Member code never runs on the server for this — the server only
receives an image, checks what it is and re-encodes it (like the
screenshots on 의견 보내기): the kind is read from the bytes, the picture
is decoded under the pixel guard, cropped to 16:10, scaled to
`WIDTH × HEIGHT` and written again as WebP with no metadata.

Two pictures per project, both in asset storage (never the database):

* **draft** — the working copy, refreshed whenever the Builder's
  미리보기 renders; `BuilderProject.draft_thumbnail_at`.
* **a version's** — taken right after 게시 from the published app;
  `BuilderProjectVersion.thumbnail_at`. CtrlAIApps shows the published
  version's; the Builder list shows the draft's, else the published one.

Where nothing was captured yet the screens draw the generated cover.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import BuilderProject, BuilderProjectVersion
from app.services.attachments import MAX_IMAGE_PIXELS, AttachmentRefusal, sniff
from app.services.storage import AssetStorage

#: The stored picture — 16:10 like the cards.
WIDTH = 640
HEIGHT = 400
#: What the route reads at most (a PNG of a 1280×800 page is well under).
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MEDIA_TYPE = "image/webp"

ALLOWED = {"png", "jpeg", "webp"}
UNSUPPORTED = "썸네일은 PNG, JPG, WebP 이미지여야 해요."
BROKEN = "썸네일 이미지를 읽지 못했어요."
TOO_BIG = "썸네일 이미지가 너무 커요 (4MB 이하)."
NOT_PUBLISHED = "게시된 버전이 없어요 — 먼저 게시해 주세요."


def draft_key(project: BuilderProject) -> str:
    return f"thumbnails/{project.id}/draft.webp"


def version_key(project: BuilderProject, version: BuilderProjectVersion) -> str:
    return f"thumbnails/{project.id}/v{version.number}.webp"


def encode(data: bytes) -> bytes:
    """The uploaded bytes → the stored WebP. Raises `AttachmentRefusal`.

    Checked, not trusted: the browser said "image", the bytes decide.
    Centre-cropped to 16:10 so a tall capture does not squash; a picture
    already at that ratio is only scaled.
    """
    if sniff(data) not in ALLOWED:
        raise AttachmentRefusal(UNSUPPORTED)
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as source:
            image = ImageOps.exif_transpose(source) or source
            image.load()
            if image.mode != "RGB":
                # A transparent page is drawn on white, like the frame's background.
                base = Image.new("RGB", image.size, (255, 255, 255))
                rgba = image.convert("RGBA")
                base.paste(rgba, mask=rgba.getchannel("A"))
                image = base
            fitted = ImageOps.fit(image, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS, centering=(0.5, 0.0))
            out = io.BytesIO()
            # No `exif=`: nothing of the source's metadata is copied.
            fitted.save(out, format="WEBP", quality=82, method=4)
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as error:
        raise AttachmentRefusal(BROKEN) from error
    return out.getvalue()


def save_draft(db: Session, storage: AssetStorage, project: BuilderProject, data: bytes) -> None:
    """Store the working copy's picture and stamp the project."""
    storage.save(draft_key(project), encode(data))
    project.draft_thumbnail_at = datetime.now(timezone.utc)
    db.flush()


def save_version(
    db: Session, storage: AssetStorage, project: BuilderProject, version: BuilderProjectVersion, data: bytes
) -> None:
    """Store a version's picture (the published one, taken after 게시)."""
    storage.save(version_key(project, version), encode(data))
    version.thumbnail_at = datetime.now(timezone.utc)
    db.flush()


def load_draft(storage: AssetStorage, project: BuilderProject) -> bytes | None:
    if project.draft_thumbnail_at is None:
        return None
    key = draft_key(project)
    return storage.load(key) if storage.exists(key) else None


def load_version(storage: AssetStorage, project: BuilderProject, version: BuilderProjectVersion) -> bytes | None:
    if version.thumbnail_at is None:
        return None
    key = version_key(project, version)
    return storage.load(key) if storage.exists(key) else None


def load_published(storage: AssetStorage, project: BuilderProject) -> bytes | None:
    """CtrlAIApps's picture: the published version's, or None."""
    version = project.published_version
    if version is None:
        return None
    return load_version(storage, project, version)


def delete_all(storage: AssetStorage, project: BuilderProject, versions: list[BuilderProjectVersion]) -> None:
    """Every picture of a project — for a real removal, never a soft delete."""
    for key in [draft_key(project), *(version_key(project, v) for v in versions)]:
        if storage.exists(key):
            storage.delete(key)
