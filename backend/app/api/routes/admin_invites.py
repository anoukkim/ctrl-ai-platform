"""Admin › Members › 초대 코드 (invite-only-signup).

Create a code (generated or custom), list them with who signed up with
each, switch one off and on again. Every change is written to the audit
log. A code is never deleted: accounts keep pointing at the code they
used, and switching it off stops new signups without touching them.

Admin-only, like every Admin route.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import AuditAction, InviteCode, User
from app.schemas.invite import InviteCreate, InviteRead, InviteSignup
from app.services import audit, invites

router = APIRouter(prefix="/admin/invites", tags=["admin"])

NOT_FOUND = "초대 코드를 찾을 수 없습니다."


def _read(db: Session, invite: InviteCode) -> InviteRead:
    creator = db.get(User, invite.created_by) if invite.created_by else None
    members = db.scalars(
        select(User).where(User.invite_code_id == invite.id).order_by(User.created_at, User.id)
    )
    return InviteRead(
        id=invite.id,
        code=invite.code,
        label=invite.label,
        max_uses=invite.max_uses,
        uses=invite.uses,
        expires_at=invite.expires_at,
        is_active=invite.is_active,
        status=invite.status(),
        created_by_username=creator.username if creator else "",
        created_at=invite.created_at,
        signups=[
            InviteSignup(
                user_id=member.id,
                username=member.username,
                display_name=member.display_name,
                signed_up_at=member.created_at,
            )
            for member in members
        ],
    )


def _summary(invite: InviteCode) -> str:
    limit = "1회용" if invite.max_uses == 1 else f"최대 {invite.max_uses}명"
    expiry = (
        f", {invite.expires_at.astimezone(timezone.utc):%Y-%m-%d %H:%M} UTC까지"
        if invite.expires_at
        else ""
    )
    label = f" ({invite.label})" if invite.label else ""
    return f"{invite.code}{label} — {limit}{expiry}"


@router.get("", response_model=list[InviteRead], summary="All invite codes, newest first")
def list_invites(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[InviteRead]:
    rows = db.scalars(select(InviteCode).order_by(InviteCode.created_at.desc(), InviteCode.id.desc()))
    return [_read(db, row) for row in rows]


@router.post(
    "",
    response_model=InviteRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a code — generated, or a custom one",
)
def create_invite(
    payload: InviteCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> InviteRead:
    if payload.code.strip():
        code = invites.normalise(payload.code)
        if not invites.CODE_PATTERN.match(code):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="초대 코드는 영문, 숫자, 대시(-)로 4~40자여야 합니다.",
            )
        if db.scalar(select(InviteCode.id).where(InviteCode.code == code)) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="이미 있는 초대 코드입니다."
            )
    else:
        code = invites.generate(db)

    expires_at = payload.expires_at
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="만료 시각은 지금보다 뒤여야 합니다.",
            )

    invite = InviteCode(
        code=code,
        label=payload.label.strip(),
        max_uses=payload.max_uses,
        expires_at=expires_at,
        is_active=True,
        created_by=admin.id,
    )
    db.add(invite)
    db.flush()
    audit.record(
        db,
        actor=admin,
        action=AuditAction.INVITE_CREATED,
        target_type="invite_code",
        target_id=invite.id,
        target_label=invite.code,
        summary=f"초대 코드 생성: {_summary(invite)}",
        detail={
            "code": invite.code,
            "label": invite.label,
            "max_uses": invite.max_uses,
            "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        },
    )
    db.commit()
    db.refresh(invite)
    return _read(db, invite)


def _switch(db: Session, admin: User, invite_id: int, active: bool) -> InviteRead:
    invite = db.get(InviteCode, invite_id)
    if invite is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    if invite.is_active is active:
        # Nothing changes, so nothing is logged.
        return _read(db, invite)
    invite.is_active = active
    audit.record(
        db,
        actor=admin,
        action=AuditAction.INVITE_REACTIVATED if active else AuditAction.INVITE_DEACTIVATED,
        target_type="invite_code",
        target_id=invite.id,
        target_label=invite.code,
        summary=(
            f"초대 코드 다시 사용: {invite.code}"
            if active
            else f"초대 코드 사용 중지: {invite.code} — 이미 가입한 {invite.uses}명은 그대로"
        ),
        detail={"before": not active, "after": active, "uses": invite.uses},
    )
    db.commit()
    db.refresh(invite)
    return _read(db, invite)


@router.post("/{invite_id}/deactivate", response_model=InviteRead, summary="사용 중지")
def deactivate_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> InviteRead:
    return _switch(db, admin, invite_id, active=False)


@router.post("/{invite_id}/reactivate", response_model=InviteRead, summary="다시 사용")
def reactivate_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> InviteRead:
    return _switch(db, admin, invite_id, active=True)
