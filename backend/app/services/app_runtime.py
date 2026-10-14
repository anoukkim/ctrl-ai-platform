"""The static runtime: a project's files on apps.ctrlai.my
(builder-static-runtime).

미리보기 갱신 writes the project's files into `APPS_DIR/<app-slug>/`.
Caddy serves that folder read-only on the apps origin, with a CSP, no
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

#: Added at the top of every HTML page written to the runtime. A preview
#: frame is sandboxed without `allow-same-origin`, so `localStorage` throws
#: there; this keeps an app's storage working in memory instead. Opened
#: directly, the real storage works and this does nothing.
STORAGE_SHIM = (
    "<script>(function(){try{window.localStorage.getItem('_');return}catch(e){}"
    "function m(){var d={};return{getItem:function(k){k=String(k);"
    "return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},"
    "setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},"
    "clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},"
    "get length(){return Object.keys(d).length}}}"
    "try{Object.defineProperty(window,'localStorage',{value:m(),configurable:true});"
    "Object.defineProperty(window,'sessionStorage',{value:m(),configurable:true})}catch(e){}"
    "})();</script>"
)


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


def app_url(settings: Settings, project: BuilderProject) -> str | None:
    """Where the project's files are served, once they have been written."""
    if not enabled(settings) or not project.app_slug or project.app_runtime_at is None:
        return None
    return f"{settings.apps_base_url.strip().rstrip('/')}/{project.app_slug}/"


def ensure_slug(db: Session, project: BuilderProject) -> str:
    """The project's random folder name, made the first time it is needed."""
    if project.app_slug:
        return project.app_slug
    while True:
        slug = "".join(secrets.choice(_SLUG_ALPHABET) for _ in range(SLUG_LENGTH))
        taken = db.scalar(select(BuilderProject.id).where(BuilderProject.app_slug == slug))
        if taken is None:
            project.app_slug = slug
            return slug


def with_shim(path: str, content: str) -> str:
    """HTML pages get `STORAGE_SHIM` first thing in `<head>` (or the top)."""
    if not path.lower().endswith(".html"):
        return content
    lower = content.lower()
    head = lower.find("<head")
    if head != -1:
        end = content.find(">", head)
        if end != -1:
            return content[: end + 1] + STORAGE_SHIM + content[end + 1 :]
    doctype = lower.find("<!doctype")
    if doctype != -1:
        end = content.find(">", doctype)
        if end != -1:
            return content[: end + 1] + STORAGE_SHIM + content[end + 1 :]
    return STORAGE_SHIM + content


def _folder_bytes(folder: Path) -> int:
    total = 0
    for root, _dirs, names in os.walk(folder):
        for name in names:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                pass
    return total


def publish(
    db: Session, settings: Settings, project: BuilderProject, files: dict[str, str]
) -> str:
    """Write `files` as the project's app and return its address.

    Raises `AppRuntimeError` when the runtime is off, the project has no
    index.html, or all apps together would pass `APPS_MAX_TOTAL_MB`.
    """
    if not enabled(settings):
        raise AppRuntimeError("앱 미리보기 서버가 꺼져 있습니다. 관리자에게 알려 주세요.", 409)
    if builder_files.ENTRY_FILE not in files:
        raise AppRuntimeError("index.html이 있어야 미리보기를 갱신할 수 있습니다.", 409)
    try:
        builder_files.check_project(files)
        cleaned = {builder_files.clean_path(path): content for path, content in files.items()}
    except builder_files.FileRuleError as error:
        raise AppRuntimeError(str(error), 400) from error

    try:
        return _write(db, settings, project, cleaned)
    except OSError as error:
        raise AppRuntimeError(
            "앱 파일을 저장하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 알려 주세요.",
            500,
        ) from error


def _write(
    db: Session, settings: Settings, project: BuilderProject, cleaned: dict[str, str]
) -> str:
    root = apps_root(settings)
    root.mkdir(parents=True, exist_ok=True)
    slug = ensure_slug(db, project)
    target = root / slug

    rendered = {path: with_shim(path, content).encode("utf-8") for path, content in cleaned.items()}
    new_bytes = sum(len(data) for data in rendered.values())
    used = _folder_bytes(root) - (_folder_bytes(target) if target.exists() else 0)
    if used + new_bytes > settings.apps_max_total_mb * 1024 * 1024:
        raise AppRuntimeError(
            "앱 저장 공간이 가득 찼습니다. 관리자에게 알려 주세요.", 507
        )

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

    project.app_runtime_at = datetime.now(timezone.utc)
    return app_url(settings, project) or ""


def remove(settings: Settings, project: BuilderProject) -> None:
    """Stop serving the project's app (it was deleted). The slug stays on
    the row, so a restored project gets the same address back."""
    if not project.app_slug:
        return
    target = apps_root(settings) / project.app_slug
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)
    project.app_runtime_at = None
