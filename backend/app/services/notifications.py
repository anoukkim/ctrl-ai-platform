"""A member's notifications (feat-notifications, owner-polish 2).

The owner's words: "프로필 정리 뭔가 알림 같은 것도 추가하면 좋겠어. 게시가
완료됐습니다! 사용이 차감됐습니다 etc". Rows come **only from things that
really happened**, written in the same transaction by the code that did
them — never from the browser:

* **publish** — 게시 완료 / 업데이트 게시 완료 (`app_publish.publish`).
* **application** — 참여 신청 승인 / 거절 (Admin › Applications).
* **spend** — one summary **per KST day**, "어제 지원금 1,234원 사용 ·
  채팅 3회 · 빌더 1회", written when the member next opens the list
  (`ensure_spend_summaries`), from the usage ledger — a row per reply
  would be noise, and the toast already shows each charge as it happens.
  Off with Profile › 알림 › 사용 알림 표시, like the toast.
* **milestone** — the once-per-quarter spend milestones (첫 사용, 25 /
  50 / 75 %, 잔액 10,000원 이하, 잔액 0), recorded with the milestone row.
* **app_report** — an admin took the member's app down (with the reason),
  or closed a report keeping it.

Reading: newest first, at most `LIST_LIMIT`; rows older than `KEEP_DAYS`
are deleted for that member on each read. A member sees only their own —
someone else's id is a 404, like any owned thing.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import BuilderProject, Notification, Quarter, QuarterApplication, UsageEvent, User
from app.models.usage import spending_group
from app.services.chat_limits import KST

KEEP_DAYS = 90
LIST_LIMIT = 50
#: How far back a first visit writes daily spend summaries — never a flood.
SUMMARY_DAYS = 7

GROUP_LABEL = {"chat": "채팅", "build": "빌더", "video": "영상", "other": "기타"}
MILESTONE_TITLE = {
    "first": "지원금을 처음 썼어요",
    "used_25": "지원금의 25%를 썼어요",
    "used_50": "지원금의 절반을 썼어요",
    "used_75": "지원금의 75%를 썼어요",
    "low": "남은 지원금이 10,000원 이하예요",
    "empty": "지원금을 다 썼어요",
}


def notify(
    db: Session,
    user_id: int,
    kind: str,
    title: str,
    body: str = "",
    link: str | None = None,
    dedupe_key: str | None = None,
) -> Notification | None:
    """Append one row; the caller owns the transaction. With a `dedupe_key`
    that already exists for this member nothing is written (None)."""
    row = Notification(
        user_id=user_id,
        kind=kind,
        title=title[:200],
        body=body[:600],
        link=link[:300] if link else None,
        dedupe_key=dedupe_key,
    )
    if dedupe_key is None:
        db.add(row)
        db.flush()
        return row
    # Whatever the caller left pending is flushed here, outside the
    # savepoint, so its own errors reach the caller instead of being
    # mistaken for a duplicate notification.
    db.flush()
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        return None
    return row


# ------------------------------------------------------------ events


def app_published(db: Session, project: BuilderProject, *, update: bool) -> None:
    version = project.published_version_number or 0
    link = f"/ctrlaistore/{project.app_slug}" if project.app_slug else "/ctrlaistore"
    if update:
        notify(
            db, project.owner_user_id, "publish",
            f"'{project.name}' 업데이트 게시 완료 — v{version}",
            "CtrlAIApps의 앱이 새 버전으로 바뀌었어요.", link,
        )
    else:
        notify(
            db, project.owner_user_id, "publish",
            f"'{project.name}' 게시 완료 — v{version}",
            "이제 CtrlAIApps에서 다른 회원도 써 볼 수 있어요.", link,
        )


def application_reviewed(
    db: Session, application: QuarterApplication, *, approved: bool, note: str, budget_krw: int | None = None
) -> None:
    """`budget_krw` is the wallet's figure after the carry-over (the
    caller's `allocation.budget_krw`) — money text comes from the wallet row."""
    quarter = db.get(Quarter, application.quarter_id)
    name = quarter.display_name if quarter else "이번 분기"
    if approved:
        amount = budget_krw if budget_krw is not None else application.requested_budget_krw
        notify(
            db, application.user_id, "application",
            f"{name} 참여 신청이 승인됐어요",
            f"지원금 {amount:,}원으로 채팅, Builder 등 모든 기능을 쓸 수 있어요.",
            "/usage",
        )
    else:
        notify(
            db, application.user_id, "application",
            f"{name} 참여 신청이 거절됐어요",
            (note.strip() or "관리자에게 문의해 주세요.")[:600],
            "/profile",
        )


def app_taken_down(db: Session, project: BuilderProject, reason: str, version: int | None) -> None:
    notify(
        db, project.owner_user_id, "app_report",
        f"'{project.name}'이(가) CtrlAIApps에서 내려갔어요" + (f" (v{version})" if version else ""),
        ("관리자 사유: " + reason.strip()) if reason.strip() else "관리자가 게시를 내렸어요. 버전 기록은 그대로 남아 있어요.",
        f"/builder/{project.id}",
    )


def app_report_kept(db: Session, project: BuilderProject) -> None:
    notify(
        db, project.owner_user_id, "app_report",
        f"'{project.name}'에 들어온 신고를 확인했어요",
        "문제가 없어 앱은 그대로 게시되어 있어요.",
        f"/ctrlaistore/{project.app_slug}" if project.app_slug else None,
    )


def milestone_crossed(db: Session, user_id: int, quarter_id: int, kind: str, remaining_krw: int) -> None:
    title = MILESTONE_TITLE.get(kind)
    if title is None:
        return
    notify(
        db, user_id, "milestone", title,
        f"남은 지원금 {max(0, remaining_krw):,}원.",
        "/usage",
        dedupe_key=f"milestone:{quarter_id}:{kind}",
    )


# ------------------------------------------------------------ spend summaries


def _kst_day(moment: datetime) -> date:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(KST).date()


def _day_label(day: date) -> str:
    """The date itself — a row lives 90 days, so "어제" would go stale."""
    return f"{day.month}월 {day.day}일"


def ensure_spend_summaries(db: Session, user: User, *, now: datetime | None = None) -> int:
    """One "spend" row per past KST day with a charge, for the last
    `SUMMARY_DAYS` days — written here, when the member looks, from the
    ledger (reads only; money never moves here). Returns how many were
    written. Nothing while 사용 알림 표시 is off."""
    if not user.spend_notifications:
        return 0
    moment = now or datetime.now(timezone.utc)
    today = _kst_day(moment)
    first = today - timedelta(days=SUMMARY_DAYS)
    # The window starts at KST midnight `SUMMARY_DAYS` days ago, in UTC.
    since = datetime.combine(first, datetime.min.time(), tzinfo=KST).astimezone(timezone.utc)
    events = db.execute(
        select(UsageEvent.created_at, UsageEvent.feature, UsageEvent.charged_krw).where(
            UsageEvent.user_id == user.id,
            UsageEvent.charged_krw > 0,
            UsageEvent.created_at >= since,
        )
    ).all()
    by_day: dict[date, list[tuple[str | None, int]]] = {}
    for created_at, feature, charged in events:
        day = _kst_day(created_at)
        if day >= today:
            continue  # today's charges are summarised tomorrow
        by_day.setdefault(day, []).append((feature, int(charged)))
    # Days already summarised are skipped before any write — the common
    # case (nothing new) is one SELECT and no failed inserts.
    done = set(
        db.scalars(
            select(Notification.dedupe_key).where(
                Notification.user_id == user.id,
                Notification.dedupe_key.in_([f"spend:{day.isoformat()}" for day in by_day]),
            )
        )
    ) if by_day else set()
    written = 0
    for day in sorted(by_day):
        if f"spend:{day.isoformat()}" in done:
            continue
        rows = by_day[day]
        total = sum(charged for _, charged in rows)
        counts = Counter(spending_group(feature) for feature, _ in rows)
        parts = " · ".join(
            f"{GROUP_LABEL[group]} {counts[group]}회" for group in GROUP_LABEL if counts.get(group)
        )
        if notify(
            db, user.id, "spend",
            f"{_day_label(day)} 지원금 {total:,}원 사용",
            parts, "/usage",
            dedupe_key=f"spend:{day.isoformat()}",
        ):
            written += 1
    return written


# ------------------------------------------------------------ reading


def refresh(db: Session, user: User) -> None:
    """What every read does first: drop old rows, write the daily spend
    summaries up to yesterday. Commits — the caller reads afterwards."""
    prune(db, user.id)
    ensure_spend_summaries(db, user)
    db.commit()


def prune(db: Session, user_id: int, *, now: datetime | None = None) -> int:
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=KEEP_DAYS)
    result = db.execute(
        delete(Notification)
        .where(Notification.user_id == user_id, Notification.created_at < cutoff)
        .execution_options(synchronize_session="fetch")
    )
    return result.rowcount or 0


def list_for(db: Session, user: User, limit: int = LIST_LIMIT) -> list[Notification]:
    return list(
        db.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(limit)
        )
    )


def unread_count(db: Session, user_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id, Notification.read_at.is_(None)
            )
        )
        or 0
    )


def own(db: Session, user: User, notification_id: int) -> Notification | None:
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user.id:
        return None
    return row


def mark_read(db: Session, row: Notification) -> None:
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        db.flush()


def mark_all_read(db: Session, user_id: int) -> int:
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session="fetch")
    )
    return result.rowcount or 0
