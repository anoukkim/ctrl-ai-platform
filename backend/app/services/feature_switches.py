"""Run-time feature switches (owner-polish 6).

`is_open(db, VIDEO)` is the one question the guards and `/api/site` ask;
`set_open()` is the one place a switch changes — a new row and an audit
entry, in the caller's transaction. No row means the default below, so a
fresh database needs no seed and fails **closed** for video.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditAction, FeatureSwitch, User
from app.services import audit

#: The Video Generator, for members. Locked until the owner opens it.
VIDEO = "video"

DEFAULTS: dict[str, bool] = {VIDEO: False}

LABELS: dict[str, str] = {VIDEO: "Video Generator"}

#: What a member is told when the area is locked. Names what still works.
VIDEO_LOCKED = "Video Generator는 아직 잠겨 있어요 — 다음 분기에 열려요. 지금까지 만든 영상은 그대로 볼 수 있어요."


def current(db: Session, key: str) -> FeatureSwitch | None:
    """The row in force for `key` (newest), or None when nothing was set."""
    return db.scalar(
        select(FeatureSwitch)
        .where(FeatureSwitch.key == key)
        .order_by(FeatureSwitch.created_at.desc(), FeatureSwitch.id.desc())
        .limit(1)
    )


def is_open(db: Session, key: str) -> bool:
    row = current(db, key)
    return DEFAULTS.get(key, False) if row is None else row.enabled


def set_open(db: Session, admin: User, key: str, enabled: bool, note: str = "") -> FeatureSwitch:
    """Flip a switch: a new row plus an audit entry. Does not commit."""
    if key not in DEFAULTS:
        raise KeyError(key)
    before = is_open(db, key)
    row = FeatureSwitch(key=key, enabled=enabled, note=note.strip()[:200], set_by=admin.id)
    db.add(row)
    label = LABELS[key]
    state = "회원에게 열기" if enabled else "회원에게 잠그기"
    audit.record(
        db,
        actor=admin,
        action=AuditAction.FEATURE_SET,
        target_type="feature_switch",
        target_label=label,
        summary=f"{label} {state}" + (f" — {row.note}" if row.note else "") + ("" if before != enabled else " (이미 그 상태)"),
        detail={"key": key, "before": before, "after": enabled, "note": row.note},
    )
    return row
