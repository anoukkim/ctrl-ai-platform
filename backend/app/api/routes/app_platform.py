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
  a test holds that (`test_app_platform.py`).
* P2: sign-in (`/v1/login/start`, `/<slug>/_ctrlai/callback` — the one
  route under the app's own address, `callback_router` — `/v1/logout`,
  `/v1/user`) with the app-scoped cookie `ctrlai_app_<slug>`, read only
  for its own app (`app_call`); `ctrlai.ai` (`/v1/ai/ask`, `/v1/ai/stream`)
  paid by the signed-in visitor (`services/app_ai.py`).
* P3: `ctrlai.db` (`/v1/data/*`, `services/app_data.py`) — reads work
  signed out on shared collections; every write needs the app's own
  cookie and the "data" consent.
"""

import json
from dataclasses import dataclass

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import BuilderProject, User
from app.services import app_ai, app_ai_access, app_auth, app_data, app_shell, chat_limits, provider_limiter
from app.services.claude_provider import ClaudeError, get_claude_provider

router = APIRouter(prefix="/_ctrlai", tags=["app-platform"])
#: The one route under the app's own address (P2): where signing in ends.
#: Its path is the browser's, so the state cookie (Path `/<slug>/_ctrlai/`)
#: reaches it and nothing else.
callback_router = APIRouter(tags=["app-platform"])

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
    return Response(content=app_shell.render(target, app_shell.site_origins(settings)), media_type="text/html; charset=utf-8", headers=headers)


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


# ------------------------------------------------------------- P2: sign-in


SDK_OFF = "이 앱의 기능 상자는 관리자가 잠시 멈췄어요."
MEMBERS_ONLY = "CTRL+AI 회원만 쓸 수 있어요. 로그인해 주세요."


@dataclass(frozen=True)
class AppCall:
    """A `/_ctrlai/v1` call: the app, and the signed-in visitor if any."""

    target: app_shell.ShellTarget
    visitor: app_auth.Visitor | None

    @property
    def slug(self) -> str:
        project = self.target.project
        return (project.draft_slug if self.target.mode == "preview" else project.app_slug) or ""


def app_call(
    request: Request,
    target: app_shell.ShellTarget = Depends(app_request),
    db: Session = Depends(get_db),
) -> AppCall:
    """`app_request`, plus who is signed in to **this** app (this slug's
    own cookie) — never the site's session."""
    bare = AppCall(target=target, visitor=None)
    token = request.cookies.get(app_auth.cookie_name(bare.slug))
    return AppCall(target=target, visitor=app_auth.visitor(db, target.project, token))


def signed_in_visitor(call: AppCall = Depends(app_call)) -> AppCall:
    """A signed-in visitor of a running app (the 기능 상자 not stopped)."""
    if call.target.project.sdk_disabled_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=SDK_OFF)
    if call.visitor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=MEMBERS_ONLY)
    return call


def _secure(settings: Settings) -> bool:
    return (settings.apps_origin or "").startswith("https://")


@router.get("/v1/app", summary="The app the shell is running, and who is signed in")
def app_info(call: AppCall = Depends(app_call)) -> dict:
    project = call.target.project
    return {
        "name": project.name,
        "mode": call.target.mode,
        "sdk": "off" if project.sdk_disabled_at is not None else "on",
        "signedIn": call.visitor is not None,
        "user": app_auth.profile(call.visitor) if call.visitor else None,
        "scopes": list(call.visitor.consent.scopes) if call.visitor else [],
        "callCapKrw": app_ai.CALL_CAP_KRW,
        # app-ai-access: the shell's switch and the SDK's `ctrlai.ai.mode()`.
        # The maker's own 미리보기 is always "full" — they pay for their own
        # tries; anyone else holding the preview link gets the app's setting.
        "ai": {
            "usesAi": project.published_uses_ai if call.target.mode == "app" else True,
            "access": app_ai_access.FULL if _owners_preview(call) else project.ai_access,
        },
    }


@router.post("/v1/login/start", summary="Start signing in: a state, and where to consent")
def login_start(
    response: Response,
    call: AppCall = Depends(app_call),
    settings: Settings = Depends(get_settings),
) -> dict:
    if call.target.project.sdk_disabled_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=SDK_OFF)
    state = app_auth.new_state()
    # Sent back only to this app's callback address — the one path the
    # browser uses when the consent window returns.
    response.set_cookie(
        app_auth.state_cookie_name(call.slug),
        state,
        max_age=app_auth.STATE_SECONDS,
        path=f"/{call.slug}/_ctrlai/",
        httponly=True,
        secure=_secure(settings),
        samesite="strict",
    )
    sites = app_shell.site_origins(settings)
    return {"connectUrl": f"{sites[0] if sites else ''}/apps/connect?app={call.slug}&state={state}"}


CALLBACK_CSP = (
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


@callback_router.get("/{slug}/_ctrlai/callback", include_in_schema=False)
def login_callback(
    slug: str,
    request: Request,
    code: str = "",
    state: str = "",
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Where the consent window lands. Spends the one-time code, sets this
    app's cookie, tells the shell."""
    target = app_shell.resolve(db, slug)
    token = None
    if target is not None and target.project.sdk_disabled_at is None:
        token = app_auth.exchange(
            db, target.project, code, state, request.cookies.get(app_auth.state_cookie_name(slug), "")
        )
    ok = token is not None
    message = "로그인했어요. 앱으로 돌아가요…" if ok else "로그인하지 못했어요. 앱에서 다시 시도해 주세요."
    page = (
        '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>CTRL+AI 로그인</title>'
        '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
        f'<body data-ok="{1 if ok else 0}" data-slug="{slug if target else ""}" '
        'style="font:15px/1.6 system-ui,sans-serif;text-align:center;padding:3rem 1rem">'
        f'<p id="ctrlai-callback">{message}</p>'
        '<script src="/_ctrlai/callback.js"></script></body></html>'
    )
    headers = {
        "Content-Security-Policy": CALLBACK_CSP,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
    }
    result = Response(content=page, media_type="text/html; charset=utf-8", headers=headers)
    result.delete_cookie(app_auth.state_cookie_name(slug), path=f"/{slug}/_ctrlai/")
    if ok:
        db.commit()
        result.set_cookie(
            app_auth.cookie_name(slug),
            token,
            max_age=app_auth.SESSION_DAYS * 24 * 3600,
            path="/_ctrlai/",
            httponly=True,
            secure=_secure(settings),
            samesite="strict",
        )
    else:
        db.rollback()
    return result


@router.get("/callback.js", include_in_schema=False)
def callback_script() -> Response:
    """Loaded only by the callback page, on this origin."""
    return _script("callback.js", "same-origin")


@router.post("/v1/logout", summary="Sign out of this app")
def logout(
    response: Response,
    call: AppCall = Depends(app_call),
    db: Session = Depends(get_db),
) -> dict:
    if call.visitor is not None:
        app_auth.sign_out(db, call.visitor)
        db.commit()
    response.delete_cookie(app_auth.cookie_name(call.slug), path="/_ctrlai/")
    return {"signedIn": False}


@router.get("/v1/user", summary="ctrlai.user(): a name and a per-app id")
def app_user(call: AppCall = Depends(signed_in_visitor)) -> dict:
    return app_auth.profile(call.visitor)


# --------------------------------------------------------------- P2: AI


class AskBody(BaseModel):
    """`ctrlai.ai.ask` / `stream` options, as the SDK sends them."""

    model_config = ConfigDict(populate_by_name=True)

    prompt: str = Field(default="", max_length=app_ai.MAX_PROMPT_CHARS)
    system: str = Field(default="", max_length=app_ai.MAX_SYSTEM_CHARS)
    images: list[str] = Field(default_factory=list, max_length=app_ai.MAX_IMAGES)
    #: A JSON Schema the reply must match (ask only). `json` in the SDK.
    json_schema: dict | None = Field(default=None, alias="json")
    model: str = "fast"
    max_tokens: int | None = Field(default=None, ge=1, le=app_ai.MAX_TOKENS_LIMIT, alias="maxTokens")

    def as_input(self) -> app_ai.AskInput:
        return app_ai.AskInput(
            prompt=self.prompt,
            system=self.system,
            images=self.images,
            schema=self.json_schema,
            model=self.model,
            max_tokens=self.max_tokens,
        )


def _owners_preview(call: AppCall) -> bool:
    """The Builder's 미리보기 used by the project's own maker (app-ai-access):
    the one place the 데모만 setting does not apply — another member who
    was handed the preview link is a visitor like any other."""
    return (
        call.target.mode == "preview"
        and call.visitor is not None
        and call.visitor.user.id == call.target.project.owner_user_id
    )


def _ai_allowed(call: AppCall) -> None:
    # app-ai-access: 데모만 — a visitor's call is refused before anything is
    # prepared or charged; the app shows its demo answer (code "demo"). The
    # maker's own 미리보기 is never limited.
    if not _owners_preview(call) and call.target.project.ai_access != app_ai_access.FULL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"message": app_ai_access.DEMO_ONLY, "code": app_ai_access.DEMO_CODE},
        )
    if "ai" not in call.visitor.consent.scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="이 앱에 AI 사용을 허용하지 않았어요.")


BUSY = "지금 AI가 바빠요. 잠시 후 다시 해 주세요."


class EstimateBody(AskBody):
    """`ctrlai.ai.estimate`: the same options, but `images` is a **count**
    (the SDK turns data URLs into one before sending — the photo need not
    be picked yet, and nothing is read on this free, signed-out route)."""

    images: int = Field(default=0, ge=0, le=app_ai.MAX_IMAGES)  # type: ignore[assignment]

    @property
    def image_count(self) -> int:
        return self.images


@router.post("/v1/ai/estimate", summary="ctrlai.ai.estimate: what a call would cost (free, signed out too)")
def ai_estimate(
    body: EstimateBody,
    call: AppCall = Depends(app_call),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Nothing is sent to Claude and nothing is charged. The figures use
    the formulas `ask` checks with, every image at its upper bound, so a
    call made with the same options never costs more than `maxKrw` —
    the JSON retry included (app-platform P4b)."""
    if call.target.project.sdk_disabled_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=SDK_OFF)
    data = app_ai.AskInput(
        prompt=body.prompt, system=body.system, images=[], schema=body.json_schema, model=body.model, max_tokens=body.max_tokens
    )
    try:
        figures = app_ai.estimate(db, settings, data, body.image_count)
    except app_ai.AppAIError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    return {"typicalKrw": figures.typical_krw, "maxKrw": figures.max_krw, "model": figures.model}


@router.post("/v1/ai/ask", summary="ctrlai.ai.ask: one answer, paid by the visitor")
async def ai_ask(
    body: AskBody,
    call: AppCall = Depends(signed_in_visitor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    _ai_allowed(call)
    limit = chat_limits.current(db).provider_concurrency
    if not await run_in_threadpool(provider_limiter.acquire, limit):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=BUSY)
    try:
        result = await app_ai.ask(
            db,
            settings,
            get_claude_provider(settings),
            user=call.visitor.user,
            project=call.target.project,
            data=body.as_input(),
            is_mock=settings.provider_is_mock("claude"),
            preview=call.target.mode == "preview",
        )
    except app_ai.AppAIError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    finally:
        provider_limiter.release()
    return {"text": result.text, "json": result.json, "chargedKrw": result.charged_krw, "model": result.model}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/v1/ai/stream", summary="ctrlai.ai.stream: the answer as it is written")
async def ai_stream(
    body: AskBody,
    request: Request,
    call: AppCall = Depends(signed_in_visitor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Every refusal comes before the stream (a plain HTTP error). Once it
    runs, the cost is settled however it ends — in a session of its own,
    as Chat does, because the request's may be gone by then."""
    _ai_allowed(call)
    if body.json_schema is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="JSON 형식은 ask에서만 쓸 수 있어요.")
    try:
        prepared = app_ai.prepare(
            db, settings, user=call.visitor.user, project=call.target.project, data=body.as_input()
        )
    except app_ai.AppAIError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    limit = chat_limits.current(db).provider_concurrency
    user_id, project_id = call.visitor.user.id, call.target.project.id
    preview = call.target.mode == "preview"
    session_factory = request.app.dependency_overrides.get(get_db, get_db)
    provider = get_claude_provider(settings)
    is_mock = settings.provider_is_mock("claude")

    def settle(tally: app_ai.Tally | None, failure: ClaudeError | None) -> int:
        sessions = session_factory()
        session = next(sessions)
        try:
            charged = 0
            if tally is not None and (tally.input_tokens or tally.output_tokens):
                charged = app_ai.charge(
                    session,
                    settings,
                    user=session.get(User, user_id),
                    project=session.get(BuilderProject, project_id),
                    prepared=prepared,
                    input_tokens=tally.input_tokens,
                    output_tokens=tally.output_tokens,
                    is_mock=is_mock,
                    preview=preview,
                )
            if failure is not None:
                app_ai.record_failure(session, failure)
            return charged
        finally:
            sessions.close()

    async def events():
        if not await run_in_threadpool(provider_limiter.acquire, limit):
            yield _sse("error", {"message": BUSY, "chargedKrw": 0})
            return
        tally: app_ai.Tally | None = None
        failure: ClaudeError | None = None
        try:
            async for kind, value in app_ai.run(provider, prepared):
                if kind == "delta":
                    yield _sse("delta", {"text": value})
                else:
                    tally = value
        except ClaudeError as error:
            failure = error
        finally:
            provider_limiter.release()
        charged = await run_in_threadpool(settle, tally, failure)
        if failure is not None:
            yield _sse("error", {"message": str(failure), "chargedKrw": charged})
        else:
            yield _sse("done", {"text": tally.text if tally else "", "chargedKrw": charged, "model": prepared.label})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------- P3: data


def running_app(call: AppCall = Depends(app_call)) -> AppCall:
    """A running app (the 기능 상자 not stopped); the visitor may be signed out."""
    if call.target.project.sdk_disabled_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=SDK_OFF)
    return call


def _reader(call: AppCall) -> app_data.Reader:
    return app_data.Reader(
        project=call.target.project,
        space=app_data.space_of(call.target.mode),
        user=call.visitor.user if call.visitor else None,
    )


def _writer(call: AppCall) -> app_data.Reader:
    """A signed-in visitor who allowed "data". A consent from before P3
    lacks it: the shell asks the visitor to allow the app again."""
    if call.visitor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=MEMBERS_ONLY)
    if "data" not in call.visitor.consent.scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"message": "이 앱에 데이터 저장을 아직 허용하지 않았어요. 다시 연결해 주세요.", "code": "consent_required"},
        )
    return _reader(call)


def _data_error(error: app_data.AppDataError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail={"message": str(error), "code": error.code})


class DataListBody(BaseModel):
    """`ctrlai.db.list` options, as the SDK sends them. `shared` names
    which of the two collections of that name (every data body has it)."""

    model_config = ConfigDict(populate_by_name=True)

    collection: str = Field(max_length=40)
    shared: bool = False
    where: dict | None = None
    order_by: str | None = Field(default=None, alias="orderBy", max_length=40)
    order: str | None = Field(default=None, max_length=4)
    limit: int = app_data.DEFAULT_LIMIT
    cursor: str | None = Field(default=None, max_length=20)
    mine: bool = False


class DataCountBody(BaseModel):
    collection: str = Field(max_length=40)
    shared: bool = False
    where: dict | None = None
    mine: bool = False


class DataGetBody(BaseModel):
    collection: str = Field(max_length=40)
    shared: bool = False
    id: str = Field(max_length=20)


class DataSaveBody(BaseModel):
    collection: str = Field(max_length=40)
    shared: bool = False
    data: dict


class DataUpdateBody(BaseModel):
    collection: str = Field(max_length=40)
    shared: bool = False
    id: str = Field(max_length=20)
    data: dict


class DataRemoveBody(BaseModel):
    collection: str = Field(max_length=40)
    shared: bool = False
    id: str = Field(max_length=20)


class DataReportBody(BaseModel):
    collection: str = Field(max_length=40)
    id: str = Field(max_length=20)
    reason: str = Field(default="", max_length=app_data.MAX_REASON_CHARS)


@router.post("/v1/data/list", summary="ctrlai.db.list: a page of a collection")
def data_list(body: DataListBody, call: AppCall = Depends(running_app), db: Session = Depends(get_db)) -> dict:
    try:
        options = app_data.list_options(
            where=body.where, order_by=body.order_by, order=body.order, limit=body.limit, cursor=body.cursor, mine=body.mine
        )
        return app_data.list_items(db, _reader(call), body.collection, body.shared, options)
    except app_data.AppDataError as error:
        raise _data_error(error) from error


@router.post("/v1/data/count", summary="ctrlai.db.count")
def data_count(body: DataCountBody, call: AppCall = Depends(running_app), db: Session = Depends(get_db)) -> dict:
    try:
        return {"count": app_data.count_items(db, _reader(call), body.collection, body.shared, body.where, body.mine)}
    except app_data.AppDataError as error:
        raise _data_error(error) from error


@router.post("/v1/data/get", summary="ctrlai.db.get: one item, or null")
def data_get(body: DataGetBody, call: AppCall = Depends(running_app), db: Session = Depends(get_db)) -> dict:
    try:
        return {"item": app_data.get_item(db, _reader(call), body.collection, body.shared, body.id)}
    except app_data.AppDataError as error:
        raise _data_error(error) from error


@router.post("/v1/data/save", summary="ctrlai.db.save: a new item")
def data_save(body: DataSaveBody, call: AppCall = Depends(running_app), db: Session = Depends(get_db)) -> dict:
    reader = _writer(call)
    try:
        item = app_data.save_item(db, reader, body.collection, body.shared, body.data)
    except app_data.AppDataError as error:
        db.rollback()
        raise _data_error(error) from error
    db.commit()
    return {"item": item}


@router.post("/v1/data/update", summary="ctrlai.db.update: change some fields of my item")
def data_update(body: DataUpdateBody, call: AppCall = Depends(running_app), db: Session = Depends(get_db)) -> dict:
    reader = _writer(call)
    try:
        item = app_data.update_item(db, reader, body.collection, body.shared, body.id, body.data)
    except app_data.AppDataError as error:
        db.rollback()
        raise _data_error(error) from error
    db.commit()
    return {"item": item}


@router.post("/v1/data/remove", summary="ctrlai.db.remove")
def data_remove(body: DataRemoveBody, call: AppCall = Depends(running_app), db: Session = Depends(get_db)) -> dict:
    reader = _writer(call)
    try:
        app_data.remove_item(db, reader, body.collection, body.shared, body.id)
    except app_data.AppDataError as error:
        db.rollback()
        raise _data_error(error) from error
    db.commit()
    return {"removed": True}


@router.post("/v1/data/report", summary="ctrlai.db.report: 신고 a shared item to the admin")
def data_report(body: DataReportBody, call: AppCall = Depends(running_app), db: Session = Depends(get_db)) -> dict:
    reader = _writer(call)
    try:
        app_data.report_item(db, reader, body.collection, body.id, body.reason)
    except app_data.AppDataError as error:
        db.rollback()
        raise _data_error(error) from error
    db.commit()
    return {"detail": "신고했어요. 관리자가 확인할게요."}
