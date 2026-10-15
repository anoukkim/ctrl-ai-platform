"""CTRL+AI 기능 상자 — the apps origin's own routes (app-platform P1).

Mounted at `/_ctrlai`, **outside** `/api`: Caddy sends
`apps.ctrlai.my/_ctrlai/*` here (and `apps.ctrlai.my/<slug>/` to
`/_ctrlai/shell/<slug>`); the club's site only forwards `/api/*`, so none
of this is reachable from `ctrlai.my`.

* `GET /_ctrlai/sdk.js`, `GET /_ctrlai/shell.js` — the two scripts.
* `GET /_ctrlai/shell/{slug}` — the trusted shell page for one app.
* `GET /_ctrlai/v1/app` — what the shell asks the server. Guarded by
  `app_request`: the slug in `X-CtrlAI-App` must be a live app, and a
  browser must say the request is same-origin. These routes **never read
  the main session cookie** — nothing here imports `get_current_user`, and
  a test holds that (`test_app_platform.py`). Sign-in for apps comes in P2
  with its own app-scoped cookie.
"""

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.services import app_shell

router = APIRouter(prefix="/_ctrlai", tags=["app-platform"])

#: Scripts change only with a deploy; a browser checks again each time.
SCRIPT_HEADERS = {"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}

NOT_FOUND = "앱을 찾을 수 없어요. 주소를 확인하거나 CtrlAIApps에서 다시 열어 주세요."


def _script(name: str, resource_policy: str) -> Response:
    return Response(
        content=app_shell.static_file(name),
        media_type="text/javascript; charset=utf-8",
        headers={**SCRIPT_HEADERS, "Cross-Origin-Resource-Policy": resource_policy},
    )


@router.get("/sdk.js", include_in_schema=False)
def sdk_script() -> Response:
    """Loaded by the member's page, whose origin is opaque — to the browser
    a cross-origin load, so the resource policy must allow it. The file is
    public; it holds nothing about anyone."""
    return _script("sdk.js", "cross-origin")


@router.get("/shell.js", include_in_schema=False)
def shell_script() -> Response:
    """Loaded only by the shell page, on this origin."""
    return _script("shell.js", "same-origin")


@router.get("/shell/{slug}", include_in_schema=False)
def shell_page(
    slug: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The shell for a published app (mode "app") or a working copy
    (mode "preview"). Unknown, unpublished or deleted → 404."""
    target = app_shell.resolve(db, slug)
    headers = {
        "Content-Security-Policy": app_shell.shell_csp(app_shell.shell_ancestors(settings)),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
    }
    if target is None:
        return Response(content=NOT_FOUND, status_code=404, media_type="text/plain; charset=utf-8", headers=headers)
    return Response(content=app_shell.render(target), media_type="text/html; charset=utf-8", headers=headers)


def app_request(
    request: Request,
    x_ctrlai_app: str = Header(default=""),
    db: Session = Depends(get_db),
) -> app_shell.ShellTarget:
    """The guard on every `/_ctrlai/v1/*` route.

    * `X-CtrlAI-App: <slug>` is required — a header no form, link or image
      can carry, so a request needs script on this origin; and a cross-origin
      script would need a preflight, which this router never answers.
    * When the browser says where a request comes from (`Sec-Fetch-Site`),
      it must be `same-origin`: the shell's own page.
    * The slug must be a live app; its shell is the only caller.
    """
    site = request.headers.get("sec-fetch-site")
    if site is not None and site != "same-origin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="허용되지 않은 요청이에요.")
    target = app_shell.resolve(db, x_ctrlai_app.strip())
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return target


@router.get("/v1/app", summary="The app the shell is running")
def app_info(target: app_shell.ShellTarget = Depends(app_request)) -> dict:
    """Name and mode. P2 adds the visitor's sign-in state here."""
    return {"name": target.project.name, "mode": target.mode, "sdk": "on"}
