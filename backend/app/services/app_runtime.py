"""The static runtime: a project's files on apps.ctrlai.my
(builder-static-runtime).

Two folders per project under `APPS_DIR` (ctrlaiapps-publish):

* `<draft-slug>/` — the working copy, rewritten after every change and by
  미리보기 갱신, for the Builder's preview. Never listed anywhere.
* `<app-slug>/` — the **published** version only, written by 게시 /
  업데이트 게시 and removed by 게시 취소. CtrlAIApps opens this one, so
  editing after publishing changes nothing a visitor sees.

Caddy serves both read-only on the apps origin, with a CSP, no
cookies and framing allowed by CTRL+AI only (`deploy/Caddyfile`). The
backend only *writes* files — it never runs them; they execute in
visitors' browsers (CLAUDE.md section 10).

Writing is all-or-nothing: the files go to a hidden temporary folder
first, which then takes the app folder's place. A visitor sees the old
version or the new one, never half of each. Hidden names (a leading dot)
are never served.
"""

from __future__ import annotations

import os
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import BACKEND_DIR, Settings
from app.models import BuilderProject
from app.services import builder_files

#: Lower-case letters and digits, no look-alikes — a slug is read aloud.
_SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
SLUG_LENGTH = 10

#: Added first thing in every HTML page written to the runtime
#: (app-platform P1): the SDK, from this origin. It defines `ctrlai` and,
#: since the app runs sandboxed where `localStorage` throws, a
#: `localStorage` kept by the shell. Before P1 this was an inline
#: in-memory shim (`STORAGE_SHIM`); pages written then are rewritten by
#: `python -m app.db.rewrite_app_runtime`.
SDK_TAG = '<script src="/_ctrlai/sdk.js"></script>'


class AppRuntimeError(Exception):
    """A Korean sentence for the member, and an HTTP status."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def apps_root(settings: Settings) -> Path:
    configured = Path(settings.apps_dir)
    return configured if configured.is_absolute() else BACKEND_DIR / configured


def enabled(settings: Settings) -> bool:
    return settings.apps_origin is not None


def _base(settings: Settings) -> str:
    return settings.apps_base_url.strip().rstrip("/")


def draft_url(settings: Settings, project: BuilderProject) -> str | None:
    """The working copy's preview address, once written (ctrlaiapps-publish)."""
    if not enabled(settings) or not project.draft_slug or project.app_runtime_at is None:
        return None
    return f"{_base(settings)}/{project.draft_slug}/"


def public_url(settings: Settings, project: BuilderProject) -> str | None:
    """The published app's address — what CtrlAIApps opens. None unless
    a version is published."""
    if not enabled(settings) or not project.app_slug or project.published_version_id is None:
        return None
    return f"{_base(settings)}/{project.app_slug}/"


def _new_slug(db: Session) -> str:
    while True:
        slug = "".join(secrets.choice(_SLUG_ALPHABET) for _ in range(SLUG_LENGTH))
        taken = db.scalar(
            select(BuilderProject.id).where(
                (BuilderProject.app_slug == slug) | (BuilderProject.draft_slug == slug)
            )
        )
        if taken is None:
            return slug


def ensure_slug(db: Session, project: BuilderProject) -> str:
    """The project's public folder name, made the first time it publishes."""
    if not project.app_slug:
        project.app_slug = _new_slug(db)
    return project.app_slug


def ensure_draft_slug(db: Session, project: BuilderProject) -> str:
    """The working copy's folder name, made the first time it is written."""
    if not project.draft_slug:
        project.draft_slug = _new_slug(db)
    return project.draft_slug


def with_shim(path: str, content: str) -> str:
    """HTML pages get `SDK_TAG` first thing in `<head>` (or the top)."""
    if not path.lower().endswith(".html"):
        return content
    lower = content.lower()
    head = lower.find("<head")
    if head != -1:
        end = content.find(">", head)
        if end != -1:
            return content[: end + 1] + SDK_TAG + content[end + 1 :]
    doctype = lower.find("<!doctype")
    if doctype != -1:
        end = content.find(">", doctype)
        if end != -1:
            return content[: end + 1] + SDK_TAG + content[end + 1 :]
    return SDK_TAG + content


def _folder_bytes(folder: Path) -> int:
    total = 0
    for root, _dirs, names in os.walk(folder):
        for name in names:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                pass
    return total


def _checked(settings: Settings, files: dict[str, str]) -> dict[str, str]:
    if not enabled(settings):
        raise AppRuntimeError("앱 미리보기 서버가 꺼져 있습니다. 관리자에게 알려 주세요.", 409)
    if builder_files.ENTRY_FILE not in files:
        raise AppRuntimeError("index.html이 있어야 미리보기를 갱신할 수 있습니다.", 409)
    try:
        builder_files.check_project(files)
        cleaned = {builder_files.clean_path(path): content for path, content in files.items()}
    except builder_files.FileRuleError as error:
        raise AppRuntimeError(str(error), 400) from error
    # 안내 문서 stay in the project and its ZIP; only the app is served (Q3).
    return builder_files.app_files(cleaned)


def write_draft(
    db: Session, settings: Settings, project: BuilderProject, files: dict[str, str]
) -> str:
    """Write the working copy for the Builder's preview; return its address.

    Raises `AppRuntimeError` when the runtime is off, the project has no
    index.html, or all apps together would pass `APPS_MAX_TOTAL_MB`.
    """
    cleaned = _checked(settings, files)
    slug = ensure_draft_slug(db, project)
    _write_or_explain(settings, slug, cleaned)
    project.app_runtime_at = datetime.now(timezone.utc)
    return draft_url(settings, project) or ""


def write_public(
    db: Session, settings: Settings, project: BuilderProject, files: dict[str, str]
) -> None:
    """Write the published version to the public folder (게시 / 업데이트 게시)."""
    cleaned = _checked(settings, files)
    slug = ensure_slug(db, project)
    _write_or_explain(settings, slug, cleaned)


def _write_or_explain(settings: Settings, slug: str, cleaned: dict[str, str]) -> None:
    try:
        _write(settings, slug, cleaned)
    except OSError as error:
        raise AppRuntimeError(
            "앱 파일을 저장하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 알려 주세요.",
            500,
        ) from error


def _write(settings: Settings, slug: str, cleaned: dict[str, str]) -> None:
    """All-or-nothing: a hidden staging folder takes the old one's place."""
    root = apps_root(settings)
    root.mkdir(parents=True, exist_ok=True)
    target = root / slug

    rendered = {path: with_shim(path, content).encode("utf-8") for path, content in cleaned.items()}
    new_bytes = sum(len(data) for data in rendered.values())
    used = _folder_bytes(root) - (_folder_bytes(target) if target.exists() else 0)
    if used + new_bytes > settings.apps_max_total_mb * 1024 * 1024:
        raise AppRuntimeError("앱 저장 공간이 가득 찼습니다. 관리자에게 알려 주세요.", 507)

    staging = root / f".tmp-{slug}-{secrets.token_hex(4)}"
    staging.mkdir()
    try:
        for path, data in rendered.items():
            destination = (staging / path).resolve()
            if staging.resolve() not in destination.parents:
                raise AppRuntimeError("허용되지 않는 파일 이름입니다.", 400)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        old = None
        if target.exists():
            old = root / f".old-{slug}-{secrets.token_hex(4)}"
            os.replace(target, old)
        os.replace(staging, target)
        if old is not None:
            shutil.rmtree(old, ignore_errors=True)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _remove_folder(settings: Settings, slug: str | None) -> None:
    if not slug:
        return
    target = apps_root(settings) / slug
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


def remove_public(settings: Settings, project: BuilderProject) -> None:
    """Stop serving the published app (게시 취소, admin unpublish). The slug
    stays on the row, so publishing again keeps the same address."""
    _remove_folder(settings, project.app_slug)


def remove(settings: Settings, project: BuilderProject) -> None:
    """Stop serving everything of the project (it was deleted). The slugs
    stay on the row, so a restored project keeps its addresses."""
    _remove_folder(settings, project.app_slug)
    _remove_folder(settings, project.draft_slug)
    project.app_runtime_at = None
