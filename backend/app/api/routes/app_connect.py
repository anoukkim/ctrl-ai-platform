"""CTRL+AI 기능 상자 on the club's site — 연결 (app-platform P2).

The member's side of signing in to an app, under `/api` with the site's
own session:

* `GET /api/app-connect/{slug}` — what the consent screen shows: the app,
  its maker, what it may do and roughly what one AI call costs.
* `POST /api/app-connect/{slug}` — 허용: record the consent, make the
  one-time code and answer where the window goes next (the app's
  callback). The `state` the shell started with travels along.
* `GET /api/me/app-consents`, `POST /api/me/app-consents/{id}/revoke` —
  Profile › 연결된 앱.

The code is the only thing that crosses from the site to the apps origin,
and it is worth nothing without the state cookie of the browser that
started the sign-in (`services/app_auth.py`).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AccountStatus, AppConsent, BuilderProject, User
from app.services import app_ai, app_auth, app_runtime, app_shell, chat_models, pricing

router = APIRouter(tags=["app-platform"])

NOT_FOUND = "앱을 찾을 수 없어요. 주소를 확인하거나 CtrlAIApps에서 다시 열어 주세요."


class ScopeRead(BaseModel):
    key: str
    label: str


class ConnectInfo(BaseModel):
    name: str
    owner_name: str
    mode: str
    scopes: list[ScopeRead]
    #: About what one "fast" call costs, and the most one call may cost.
    ai_estimate_krw: int | None
    call_cap_krw: int
    connected: bool


class ConnectBody(BaseModel):
    state: str = Field(min_length=16, max_length=100)


class ConnectResult(BaseModel):
    redirect_url: str


class ConsentRead(BaseModel):
    id: int
    app_name: str
    app_url: str | None
    scopes: list[ScopeRead]
    granted_at: datetime


def _target(db: Session, slug: str) -> app_shell.ShellTarget:
    target = app_shell.resolve(db, slug)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    if target.project.sdk_disabled_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="이 앱의 기능 상자는 관리자가 잠시 멈췄어요.")
    return target


def _scopes(keys) -> list[ScopeRead]:
    return [ScopeRead(key=key, label=app_auth.SCOPES[key]) for key in keys if key in app_auth.SCOPES]


@router.get("/app-connect/{slug}", response_model=ConnectInfo, summary="The consent screen of an app")
def connect_info(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ConnectInfo:
    target = _target(db, slug)
    project = target.project
    owner = db.get(User, project.owner_user_id)
    owner_name = "탈퇴 회원" if owner is None or owner.account_status is AccountStatus.FORMER else owner.display_name
    estimate = None
    try:
        model, _ = app_ai.choose_model(db, settings, "fast")
        estimate = pricing.typical_reply_krw(model, pricing.current_rate(db))
    except (app_ai.AppAIError, chat_models.ModelChoiceError):
        estimate = None
    if estimate is not None:
        estimate = min(max(1, estimate), app_ai.CALL_CAP_KRW)
    return ConnectInfo(
        name=project.name,
        owner_name=owner_name,
        mode=target.mode,
        scopes=_scopes(app_auth.REQUESTED),
        ai_estimate_krw=estimate,
        call_cap_krw=app_ai.CALL_CAP_KRW,
        connected=app_auth.active_consent(db, user.id, project.id) is not None,
    )


@router.post("/app-connect/{slug}", response_model=ConnectResult, summary="허용: consent, and the way back to the app")
def connect(
    slug: str,
    payload: ConnectBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ConnectResult:
    target = _target(db, slug)
    if not app_runtime.enabled(settings):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="앱 주소가 꺼져 있어 연결할 수 없어요.")
    app_auth.grant(db, user, target.project)
    code = app_auth.issue_code(db, user, target.project, payload.state)
    db.commit()
    base = settings.apps_base_url.strip().rstrip("/")
    return ConnectResult(redirect_url=f"{base}/{slug}/_ctrlai/callback?code={code}&state={payload.state}")


@router.get("/me/app-consents", response_model=list[ConsentRead], summary="Profile › 연결된 앱")
def my_consents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[ConsentRead]:
    rows = db.scalars(
        select(AppConsent)
        .where(AppConsent.user_id == user.id, AppConsent.revoked_at.is_(None))
        .order_by(AppConsent.granted_at.desc())
    )
    out: list[ConsentRead] = []
    for row in rows:
        project = db.get(BuilderProject, row.project_id)
        if project is None:
            continue
        live = project.deleted_at is None
        out.append(
            ConsentRead(
                id=row.id,
                app_name=project.name if live else f"{project.name} (지워진 앱)",
                app_url=app_runtime.public_url(settings, project) if live else None,
                scopes=_scopes(row.scopes),
                granted_at=row.granted_at,
            )
        )
    return out


@router.post("/me/app-consents/{consent_id}/revoke", summary="연결 끊기")
def revoke_consent(
    consent_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    row = db.get(AppConsent, consent_id)
    if row is None or row.user_id != user.id or row.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="연결된 앱을 찾을 수 없어요.")
    app_auth.revoke(db, user, row)
    db.commit()
    return {"detail": "연결을 끊었어요. 그 앱에서 다시 쓰려면 다시 허용해야 해요."}
