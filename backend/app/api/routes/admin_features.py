"""Admin › System › 기능 열기 — run-time feature switches (owner-polish 6).

The first switch is the Video Generator for members: locked by default,
opened by the 관리자 the quarter video starts. Reading is one row per
switch; flipping writes a new row and an audit entry (`feature.set`).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import User
from app.services import feature_switches

router = APIRouter(prefix="/admin/features", tags=["admin"])


class FeatureRead(BaseModel):
    key: str
    label: str
    open: bool
    note: str
    set_by_username: str
    set_at: datetime | None


class FeatureWrite(BaseModel):
    open: bool
    note: str = Field(default="", max_length=200)


def _read(db: Session, key: str) -> FeatureRead:
    row = feature_switches.current(db, key)
    setter = db.get(User, row.set_by) if row is not None and row.set_by else None
    return FeatureRead(
        key=key,
        label=feature_switches.LABELS[key],
        open=feature_switches.DEFAULTS[key] if row is None else row.enabled,
        note=row.note if row is not None else "",
        set_by_username=setter.username if setter else "",
        set_at=row.created_at if row is not None else None,
    )


@router.get("", response_model=list[FeatureRead], summary="Every feature switch and its state")
def list_features(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[FeatureRead]:
    return [_read(db, key) for key in feature_switches.DEFAULTS]


@router.post("/{key}", response_model=FeatureRead, summary="Open or lock a feature for members (audited)")
def set_feature(
    key: str,
    payload: FeatureWrite,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> FeatureRead:
    if key not in feature_switches.DEFAULTS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="그런 기능 스위치가 없습니다.")
    feature_switches.set_open(db, admin, key, payload.open, payload.note)
    db.commit()
    return _read(db, key)
