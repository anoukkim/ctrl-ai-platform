"""App thumbnails (ui-improvements — owner-polish 4·5).

A thumbnail is a picture of the app **taken in the maker's own browser**:
the SDK inside the sandboxed app frame draws the page (DOM → SVG → canvas),
the shell relays it to the site, and the Builder page uploads the bytes
here. Member code never runs on the server for this — the server only
receives an image, checks what it is and re-encodes it (like the
screenshots on 의견 보내기): the kind is read from the bytes, the picture
is decoded under the pixel guard, made into **the first screen, like a
screenshot** — scaled to fill `WIDTH × HEIGHT` and cut from the top
(centred side to side), never letterboxed (owner, 2026-10-17: "전체가 안
나와도 되니까 걍 screenshot 으로 하는게 낫지 않음?", replacing
owner-polish-3 (a)'s whole-page fit, whose tiny pages and bands looked
nothing like the app when opened) — and written again as WebP with no
metadata.

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
from app.services.attachments import AttachmentRefusal, decode_image, sniff
from app.services.quiet import quiet_update
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


def chosen_key(project: BuilderProject) -> str:
    """thumbnail-choice: the picture the maker chose (지정하기)."""
    return f"thumbnails/{project.id}/chosen.webp"


def version_key(project: BuilderProject, version: BuilderProjectVersion) -> str:
    return version_key_for(project.id, version.number)


def version_key_for(project_id: int, number: int) -> str:
    return f"thumbnails/{project_id}/v{number}.webp"


def encode(data: bytes) -> bytes:
    """The uploaded bytes → the stored WebP. Raises `AttachmentRefusal`.

    Checked, not trusted: the browser said "image", the bytes decide.
    The whole picture is scaled to fit `WIDTH × HEIGHT`; a capture of
    another shape sits centred on a canvas of the page's own background
    (its top-left pixel), so nothing of the app is cut off.
    """
    if sniff(data) not in ALLOWED:
        raise AttachmentRefusal(UNSUPPORTED)
    from PIL import Image, ImageOps

    try:
        # The same decoder as Chat's and feedback's images: the pixel guard,
        # EXIF orientation applied and then dropped.
        image, _ = decode_image(data)
        if image.mode != "RGB":
            # A transparent page is drawn on white, like the frame's background.
            base = Image.new("RGB", image.size, (255, 255, 255))
            rgba = image.convert("RGBA")
            base.paste(rgba, mask=rgba.getchannel("A"))
            image = base
        fitted = _first_screen(image)
        out = io.BytesIO()
        # No `exif=`: nothing of the source's metadata is copied.
        fitted.save(out, format="WEBP", quality=82, method=4)
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as error:
        raise AttachmentRefusal(BROKEN) from error
    return out.getvalue()


def _first_screen(image):
    """The top of the picture filling WIDTH × HEIGHT, like a screenshot:
    scaled until both edges cover the card, then cut from the top and
    centred side to side — what a visitor sees first when the app opens."""
    from PIL import Image, ImageOps

    return ImageOps.fit(image, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS, centering=(0.5, 0.0))


#: Who made a stored picture (fix-draft-thumbs).
SERVER = "server"
BROWSER = "browser"


def save_draft(
    db: Session,
    storage: AssetStorage,
    project: BuilderProject,
    data: bytes,
    source: str = BROWSER,
    taken_of: datetime | None = None,
) -> None:
    """Store the working copy's picture and stamp the project. The server
    passes `taken_of`, the `app_runtime_at` it photographed, as the stamp:
    a render that finishes after the next edit must not look as new as
    that edit (`browser_may_replace_draft`)."""
    storage.save(draft_key(project), encode(data))
    # A picture is not an edit: `updated_at` (마지막 수정순) stays.
    quiet_update(
        db,
        project,
        draft_thumbnail_at=taken_of or datetime.now(timezone.utc),
        draft_thumbnail_source=source,
    )


def save_version(
    db: Session,
    storage: AssetStorage,
    project: BuilderProject,
    version: BuilderProjectVersion,
    data: bytes,
    source: str = BROWSER,
) -> None:
    """Store a version's picture (the published one, taken after 게시)."""
    storage.save(version_key(project, version), encode(data))
    quiet_update(db, version, thumbnail_at=datetime.now(timezone.utc), thumbnail_source=source)


def browser_may_replace_draft(project: BuilderProject, server_on: bool) -> bool:
    """fix-draft-thumbs. The in-browser capture draws the app without its
    web fonts, so while the server renders (`server_on`) it is only the
    fallback: it may store the working copy's picture when there is none,
    when the stored one is the browser's, when no files are written
    (`app_runtime_at` NULL), or when the server's is older than the
    working copy (its render failed or is still queued — the
    server's next picture replaces it again)."""
    if not server_on or project.draft_thumbnail_at is None:
        return True
    if project.draft_thumbnail_source != SERVER or project.app_runtime_at is None:
        return True
    return project.draft_thumbnail_at < project.app_runtime_at


def browser_may_replace_version(version: BuilderProjectVersion, server_on: bool) -> bool:
    """The same rule for a published version's picture; a version's files
    never change, so a server picture of it is always current."""
    return not server_on or version.thumbnail_at is None or version.thumbnail_source != SERVER


def save_chosen(db: Session, storage: AssetStorage, project: BuilderProject, data: bytes) -> None:
    """thumbnail-choice: the maker's own picture — checked and re-encoded
    like every upload — shown instead of the automatic ones until reset."""
    storage.save(chosen_key(project), encode(data))
    quiet_update(db, project, thumbnail_chosen_at=datetime.now(timezone.utc))


def clear_chosen(db: Session, storage: AssetStorage, project: BuilderProject) -> None:
    """자동으로 되돌리기: the automatic pictures show again."""
    quiet_update(db, project, thumbnail_chosen_at=None)
    key = chosen_key(project)
    if storage.exists(key):
        storage.delete(key)


def load_chosen(storage: AssetStorage, project: BuilderProject) -> bytes | None:
    if project.thumbnail_chosen_at is None:
        return None
    key = chosen_key(project)
    return storage.load(key) if storage.exists(key) else None


def load_draft(storage: AssetStorage, project: BuilderProject) -> bytes | None:
    """The Builder card's picture: the chosen one, else the working copy's."""
    chosen = load_chosen(storage, project)
    if chosen is not None:
        return chosen
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
    """CtrlAIApps's picture: the chosen one once published, else the
    published version's — or, until that one is photographed, the newest
    earlier version's (fix-thumbnail-keep) — or None."""
    if project.published_version is None:
        return None
    picture = project.published_picture_version
    return load_chosen(storage, project) or (load_version(storage, project, picture) if picture is not None else None)


def storage_keys(project_id: int, numbers: list[int]) -> list[str]:
    """Every picture a project may have, for the purge's clean-up."""
    keys = [f"thumbnails/{project_id}/draft.webp", f"thumbnails/{project_id}/chosen.webp"]
    return keys + [version_key_for(project_id, number) for number in numbers]


def forget_versions(storage: AssetStorage, project_id: int, numbers: list[int]) -> None:
    """The pictures of versions being pruned (builder_versions.snapshot) —
    a row that is gone must not leave a file behind."""
    for number in numbers:
        key = version_key_for(project_id, number)
        if storage.exists(key):
            storage.delete(key)
