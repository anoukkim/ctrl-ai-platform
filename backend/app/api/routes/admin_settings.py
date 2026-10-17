"""Admin's small adds (admin-consolidation v3 (4)).

* **비밀번호 재설정** in the member panel — until now only the
  `set_password` CLI on the server. The server makes a temporary password,
  shows it to the admin once, ends every session of the account and lifts
  its sign-in lockout; the audit row never holds the password.
* **공지 띠** in System — the top strip's text, 「띠 보이기」 and its
  의견 보내기 link. `/api/site` hands it to every page.
* **알림 기준** — the thresholds the Dashboard's alerts use.
* **백업 상태** — the last local and off-site backup the server reported.
"""

from __future__ import annotations

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import Settings, get_settings
from app.core.security import hash_password
from app.db.session import get_db
from app.api.routes.sign_in_methods import signed_in_recently
from app.models import AccountStatus, AuditAction, SiteSetting, User, UserRole
from app.services import account_sessions, audit, backups, site_settings

router = APIRouter(prefix="/admin", tags=["admin"])

#: No 0/O, 1/l/I — the admin reads it out or types it into a message.
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"


def temporary_password() -> str:
    """Four groups of four (`xxxx-xxxx-xxxx-xxxx`, about 91 bits)."""
    return "-".join("".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(4))


# ------------------------------------------------------------ password reset


class PasswordResetRequest(BaseModel):
    #: The admin confirms on purpose; a JSON body like every state change.
    confirm: bool = False


class PasswordResetRead(BaseModel):
    username: str
    #: Shown once; the server keeps only its hash.
    temporary_password: str
    #: Site sessions and member-app sessions ended.
    sessions_ended: int
    app_sessions_ended: int = 0


@router.post(
    "/members/{user_id}/password-reset",
    response_model=PasswordResetRead,
    summary="Give a member a temporary password (audited; ends their sessions)",
)
def reset_member_password(
    user_id: int,
    payload: PasswordResetRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    admin: User = Depends(require_admin),
) -> PasswordResetRead:
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="비밀번호 재설정을 확인해 주세요.")
    # Taking over an account: not from an admin browser left open long ago
    # (the same rule as linking Google).
    if not signed_in_recently(db, request, settings):
        raise HTTPException(status_code=403, detail="보안을 위해 로그아웃했다가 다시 로그인한 뒤(10분 안에) 해 주세요.")
    member = db.get(User, user_id, with_for_update=True)
    if member is None:
        raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")
    if member.id == admin.id:
        raise HTTPException(status_code=400, detail="내 비밀번호는 Profile › 로그인 방법에서 바꿔 주세요.")
    if member.account_status is AccountStatus.FORMER:
        raise HTTPException(status_code=409, detail="탈퇴한 계정은 로그인할 수 없어 비밀번호를 바꾸지 않아요.")
    if member.role is UserRole.ADMIN:
        # One admin must not be able to become another (the audit log would
        # then name the wrong person). Admins use Profile or set_password.
        raise HTTPException(status_code=409, detail="관리자 계정은 여기서 재설정하지 않아요 — 본인이 Profile에서, 또는 서버의 set_password로.")

    password = temporary_password()
    had_password = member.password_hash is not None
    member.password_hash = hash_password(password)
    # Whoever held the old password (or a cookie from it) is out — of the
    # site and of every member app, whose own sessions can spend the wallet.
    ended = account_sessions.end_everywhere(db, member)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.PASSWORD_RESET_BY_ADMIN,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=f"{member.display_name}에게 임시 비밀번호를 만들어 줬습니다"
        + ("" if had_password else " (비밀번호 로그인이 새로 생김)")
        + f" — 로그인 {ended.site}곳, 앱 로그인 {ended.apps}곳 종료",
        detail={"had_password": had_password, "sessions_ended": ended.site, "app_sessions_ended": ended.apps},
    )
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return PasswordResetRead(
        username=member.username, temporary_password=password, sessions_ended=ended.site, app_sessions_ended=ended.apps
    )


# ------------------------------------------------------------ banner


class BannerRead(BaseModel):
    shown: bool
    text: str
    feedback_link: bool
    default_text: str
    max_length: int
    set_by_username: str
    set_at: datetime | None


class BannerWrite(BaseModel):
    shown: bool
    text: str = Field(default="", max_length=site_settings.BANNER_MAX)
    feedback_link: bool = True


def _setter(db: Session, row: SiteSetting | None) -> tuple[str, datetime | None]:
    if row is None:
        return "", None
    user = db.get(User, row.set_by) if row.set_by else None
    return (user.username if user else ""), row.created_at


def _banner_read(db: Session, settings: Settings) -> BannerRead:
    current = site_settings.banner(db, settings)
    who, at = _setter(db, site_settings.banner_row(db))
    return BannerRead(
        shown=current.shown,
        text=current.text,
        feedback_link=current.feedback_link,
        default_text=site_settings.DEFAULT_BANNER_TEXT,
        max_length=site_settings.BANNER_MAX,
        set_by_username=who,
        set_at=at,
    )


@router.get("/site/banner", response_model=BannerRead, summary="The top strip as every page shows it")
def get_banner(
    db: Session = Depends(get_db), settings: Settings = Depends(get_settings), _: User = Depends(require_admin)
) -> BannerRead:
    return _banner_read(db, settings)


@router.put("/site/banner", response_model=BannerRead, summary="Change the top strip (audited)")
def put_banner(
    payload: BannerWrite,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    admin: User = Depends(require_admin),
) -> BannerRead:
    site_settings.set_banner(db, settings, admin, shown=payload.shown, text=payload.text, feedback_link=payload.feedback_link)
    db.commit()
    return _banner_read(db, settings)


# ------------------------------------------------------------ alert thresholds


class AlertsBody(BaseModel):
    wallet_pct: int
    month_pct: int
    backup_hours: int


class AlertsRead(AlertsBody):
    ranges: dict[str, tuple[int, int]]
    set_by_username: str
    set_at: datetime | None


def _alerts_read(db: Session) -> AlertsRead:
    current = site_settings.alerts(db)
    who, at = _setter(db, site_settings.alerts_row(db))
    return AlertsRead(
        wallet_pct=current.wallet_pct,
        month_pct=current.month_pct,
        backup_hours=current.backup_hours,
        ranges=site_settings.ALERT_RANGES,
        set_by_username=who,
        set_at=at,
    )


@router.get("/alert-thresholds", response_model=AlertsRead, summary="The Dashboard's alert thresholds")
def get_alerts(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> AlertsRead:
    return _alerts_read(db)


@router.put("/alert-thresholds", response_model=AlertsRead, summary="Change the alert thresholds (audited)")
def put_alerts(payload: AlertsBody, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> AlertsRead:
    try:
        site_settings.set_alerts(db, admin, site_settings.Alerts(**payload.model_dump()))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    db.commit()
    return _alerts_read(db)


# ------------------------------------------------------------ backups


class BackupLineRead(BaseModel):
    kind: str
    file_name: str | None
    size_bytes: int
    at: datetime | None
    late: bool


class BackupStatusRead(BaseModel):
    lines: list[BackupLineRead]
    late_after_hours: int
    #: Development has no backups; the screen says so instead of warning.
    is_development: bool


def backup_status(db: Session, settings: Settings) -> BackupStatusRead:
    hours = site_settings.alerts(db).backup_hours
    return BackupStatusRead(
        lines=[BackupLineRead(**vars(line)) for line in backups.status(db, hours)],
        late_after_hours=hours,
        is_development=settings.is_development,
    )


@router.get("/backups", response_model=BackupStatusRead, summary="The last local and off-site backup")
def get_backups(
    db: Session = Depends(get_db), settings: Settings = Depends(get_settings), _: User = Depends(require_admin)
) -> BackupStatusRead:
    return backup_status(db, settings)
