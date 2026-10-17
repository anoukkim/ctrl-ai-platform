"""CTRL+AI 기능 상자 — the trusted shell and the apps origin's rules
(app-platform P1).

`apps.ctrlai.my/<slug>/` is **our** page (`static/ctrlai/shell.js`), not
the member's files. It runs the app one level down, in a frame sandboxed
without `allow-same-origin`, from `/<slug>/_app/…`. Every rule of that
arrangement is a constant here, so the Caddyfile, the local apps server
and the tests all read the same text:

* `APP_FILES_CSP` — the member's files. `sandbox` makes them opaque even
  when opened on their own; `connect-src 'none'`: no network at all; the
  SDK is the only way out. Only the shell (and the club's site above it)
  may frame them.
* `SHELL_CSP` — our page: our scripts only, frames from this origin only.
* `APP_SANDBOX` — the `sandbox` attribute of the app frame (shell.js).

A slug is either a project's published `app_slug` (mode "app") or its
working copy's `draft_slug` (mode "preview", the Builder's 미리보기).
Deleted projects and unpublished slugs have no shell.
"""

from __future__ import annotations

import html
from urllib.parse import quote
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderProject

STATIC_DIR = Path(__file__).resolve().parent.parent / "static" / "ctrlai"

#: A slug as `app_runtime` makes them.
SLUG_PATTERN = re.compile(r"^[a-z2-9]{10}$")

#: The app frame's sandbox. Never `allow-same-origin`: the app's origin
#: stays opaque. No `allow-modals` (alert/confirm stay blocked, as in the
#: Builder), no top navigation; popups inherit the sandbox. Downloads are
#: allowed — an app opened on its own used to save files (a CSV export);
#: framed on the site, the outer frame still blocks them, as before.
APP_SANDBOX = "allow-scripts allow-forms allow-popups allow-downloads"


def app_files_csp(frame_ancestors: str) -> str:
    """The policy on every member file under `/<slug>/_app/`."""
    return (
        f"sandbox {APP_SANDBOX}; default-src 'self'; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; "
        f"font-src 'self' data:; connect-src 'none'; frame-ancestors {frame_ancestors}"
    )


def shell_csp(frame_ancestors: str) -> str:
    """The policy on the shell page."""
    return (
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src 'self'; "
        f"connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; "
        f"frame-ancestors {frame_ancestors}"
    )


def site_origins(settings: Settings) -> list[str]:
    """The club's own site — the only page that may frame a shell.

    `https://apps.ctrlai.my` → `https://ctrlai.my`; locally (an apps
    origin that is not `apps.<site>`) the frontend origins of
    `CORS_ALLOW_ORIGINS`.
    """
    origin = settings.apps_origin or ""
    scheme, _, host = origin.partition("://")
    if host.startswith("apps."):
        return [f"{scheme}://{host[len('apps.'):]}"]
    return settings.cors_origins


def shell_ancestors(settings: Settings) -> str:
    return " ".join(site_origins(settings)) or "'none'"


def app_files_ancestors(settings: Settings) -> str:
    """The shell (this origin) and the site above it."""
    return " ".join([settings.apps_origin or "'self'", *site_origins(settings)])


@dataclass(frozen=True)
class ShellTarget:
    project: BuilderProject
    mode: str  # "app" | "preview"


def resolve(db: Session, slug: str) -> ShellTarget | None:
    """The live project behind a slug, or None (unknown, deleted, unpublished)."""
    if not SLUG_PATTERN.match(slug):
        return None
    project = db.scalar(
        select(BuilderProject).where(
            or_(BuilderProject.app_slug == slug, BuilderProject.draft_slug == slug),
            BuilderProject.deleted_at.is_(None),
        )
    )
    if project is None:
        return None
    if project.app_slug == slug:
        if project.published_version_id is None:
            return None
        return ShellTarget(project, "app")
    if project.app_runtime_at is None:
        return None
    return ShellTarget(project, "preview")


#: app-tab-icon: every member app's tab shows the same 「앱」 icon — four
#: tiles, the last one faded — on the Primary gradient (sky → blue), so an
#: app tab is told apart from CTRL+AI's own (the brand gradient +). Owner,
#: 2026-10-17: "각각 썸넬 있는게 아니라 그냥 비슷하게 … 아이콘으로 컨테이너라던가
#: 앱이라던가", then "pick 1". A constant: nothing of the member's goes in,
#: and `img-src 'self' data:` in `shell_csp` already allows it.
APP_FAVICON = "data:image/svg+xml," + quote(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<defs><linearGradient id="g" x1="0" y1="0" x2="32" y2="0" gradientUnits="userSpaceOnUse">'
    '<stop stop-color="#5fe3f7"/><stop offset="1" stop-color="#3a6df0"/>'
    "</linearGradient></defs>"
    '<rect width="32" height="32" rx="8" fill="url(#g)"/>'
    '<g fill="#fff"><rect x="8" y="8" width="7" height="7" rx="2"/>'
    '<rect x="17" y="8" width="7" height="7" rx="2"/>'
    '<rect x="8" y="17" width="7" height="7" rx="2"/>'
    '<rect x="17" y="17" width="7" height="7" rx="2" opacity=".55"/></g>'
    "</svg>",
    safe="",
)


def render(target: ShellTarget, sites: list[str] | None = None) -> str:
    """The shell page. The app's name is escaped; the slug is read by
    shell.js from the address itself, never from here. `sites` are the
    club's own origins (`site_origins`): the only parents whose capture
    requests (ui-improvements thumbnails) the shell answers."""
    name = html.escape(target.project.name)
    suffix = " · 미리보기" if target.mode == "preview" else ""
    sites_attr = html.escape(" ".join(sites or []), quote=True)
    icon = APP_FAVICON
    return (
        "<!doctype html>\n"
        '<html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="referrer" content="no-referrer">'
        f"<title>{name}{suffix} — CTRL+AI</title>"
        f'<link rel="icon" type="image/svg+xml" href="{icon}">'
        "<style>"
        "html,body{margin:0;height:100%;color-scheme:light dark}"
        "iframe{display:block;width:100%;height:100%;border:0}"
        "#ctrlai-message{margin:2rem auto;max-width:28rem;padding:1rem;font:15px/1.6 system-ui,sans-serif;"
        "text-align:center}"
        "</style></head>"
        f'<body data-mode="{target.mode}" data-sites="{sites_attr}">'
        '<script src="/_ctrlai/shell.js"></script>'
        "</body></html>\n"
    )


def static_file(name: str) -> str:
    return (STATIC_DIR / name).read_text(encoding="utf-8")
