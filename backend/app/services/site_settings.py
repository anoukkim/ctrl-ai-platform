"""The top strip (공지 띠) and the Dashboard's alert thresholds
(admin-consolidation v3 (4)).

Owner, v3: System holds "the top strip's text, a 「띠 보이기」 on/off
switch ("배너 없앨 수도 있는 옵션") and a switch for its 의견 보내기 link".
`banner()` is what `/api/site` gives every page; `set_banner()` and
`set_alerts()` are the only writers — a new `SiteSetting` row and an
audit entry, in the caller's transaction. No row means the defaults
below: the strip shows on the beta (as before this switch existed) and
nowhere else, with the text it always had.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import AuditAction, SiteSetting, User
from app.services import audit

BANNER = "banner"
ALERTS = "alerts"

DEFAULT_BANNER_TEXT = "CTRL+AI는 지금 초대받은 회원과 함께 시험 운영 중입니다."
BANNER_MAX = 120


@dataclass
class Banner:
    shown: bool
    text: str
    feedback_link: bool


@dataclass
class Alerts:
    #: A wallet this used (percent) is listed on the Dashboard and amber in Members.
    wallet_pct: int = 80
    #: The Anthropic month's spend (percent of ANTHROPIC_MONTHLY_BUDGET_USD) that warns.
    month_pct: int = 80
    #: A local backup older than this (hours) is late.
    backup_hours: int = 48


#: What each threshold may be set to (inclusive).
ALERT_RANGES = {"wallet_pct": (50, 100), "month_pct": (50, 100), "backup_hours": (6, 24 * 14)}


def _current(db: Session, key: str) -> SiteSetting | None:
    return db.scalar(
        select(SiteSetting)
        .where(SiteSetting.key == key)
        .order_by(SiteSetting.created_at.desc(), SiteSetting.id.desc())
        .limit(1)
    )


def banner(db: Session, settings: Settings) -> Banner:
    row = _current(db, BANNER)
    value = row.value if row is not None else {}
    text = str(value.get("text") or "").strip() or DEFAULT_BANNER_TEXT
    return Banner(
        shown=bool(value.get("shown", settings.is_beta)),
        text=text[:BANNER_MAX],
        feedback_link=bool(value.get("feedback_link", True)),
    )


def banner_row(db: Session) -> SiteSetting | None:
    return _current(db, BANNER)


def set_banner(db: Session, settings: Settings, admin: User, *, shown: bool, text: str, feedback_link: bool) -> Banner:
    """Does not commit. An empty text means the default sentence."""
    before = banner(db, settings)
    clean = " ".join(text.split())[:BANNER_MAX]
    db.add(SiteSetting(key=BANNER, value={"shown": shown, "text": clean, "feedback_link": feedback_link}, set_by=admin.id))
    after = Banner(shown=shown, text=clean or DEFAULT_BANNER_TEXT, feedback_link=feedback_link)
    parts = ["띠 보이기" if shown else "띠 숨기기", "의견 보내기 링크 켬" if feedback_link else "의견 보내기 링크 끔"]
    if after.text != before.text:
        parts.append(f"문구: {after.text}")
    audit.record(
        db,
        actor=admin,
        action=AuditAction.BANNER_SET,
        target_type="site_setting",
        target_label="공지 띠",
        summary="공지 띠 — " + ", ".join(parts),
        detail={"before": asdict(before), "after": asdict(after)},
    )
    return after


def alerts(db: Session) -> Alerts:
    row = _current(db, ALERTS)
    defaults = Alerts()
    if row is None:
        return defaults
    out = {}
    for name, (low, high) in ALERT_RANGES.items():
        raw = row.value.get(name, getattr(defaults, name))
        try:
            out[name] = min(high, max(low, int(raw)))
        except (TypeError, ValueError):
            out[name] = getattr(defaults, name)
    return Alerts(**out)


def alerts_row(db: Session) -> SiteSetting | None:
    return _current(db, ALERTS)


def set_alerts(db: Session, admin: User, values: Alerts) -> Alerts:
    """Does not commit. Raises ValueError (Korean) for a value out of range."""
    for name, (low, high) in ALERT_RANGES.items():
        value = getattr(values, name)
        if not low <= value <= high:
            raise ValueError(f"{LABELS[name]}은(는) {low}–{high} 사이로 정해 주세요.")
    before = alerts(db)
    db.add(SiteSetting(key=ALERTS, value=asdict(values), set_by=admin.id))
    changed = [
        f"{LABELS[name]} {getattr(before, name)}→{getattr(values, name)}"
        for name in ALERT_RANGES
        if getattr(before, name) != getattr(values, name)
    ]
    audit.record(
        db,
        actor=admin,
        action=AuditAction.ALERTS_SET,
        target_type="site_setting",
        target_label="알림 기준",
        summary="알림 기준 — " + (", ".join(changed) if changed else "바뀐 값 없음"),
        detail={"before": asdict(before), "after": asdict(values)},
    )
    return values


LABELS = {"wallet_pct": "지원금 사용률(%)", "month_pct": "Anthropic 월 예산(%)", "backup_hours": "백업 간격(시간)"}
