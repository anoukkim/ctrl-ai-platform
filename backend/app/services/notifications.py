"""A member's notifications (feat-notifications, owner-polish 2; cut down in owner-polish-3 (c)).

The owner's words (2026-10-16 evening): "매번 쓸 때마다 알림 오면 너무
많잖아 그냥 승인됐습니다 반응을 얻었습니다 그런 것만 알림" and "알림은 그닥
중요한게 아니라서 … 걍 벨 누르면 숫자는 사라지고 clear 누르면 알림 없애기".
Rows come **only from things that really happened**, written in the same
transaction by the code that did them — never from the browser:

* **publish** — 게시 완료 / 업데이트 게시 완료 (`app_publish.publish`).
* **application** — 참여 신청 승인 / 거절 (Admin › Applications).
* **reaction** — 반응을 얻었어요: a reaction or a comment on the member's
  CtrlAITube video, or a reply to their comment — **one row per item per
  KST day** that counts up (`reaction_received`), so a popular video is
  one line, not twenty. (Apps have no reactions yet; a ★ 즐겨찾기 is the
  visitor's private preference and is never shown to the maker.)
* **app_report** — 신고 처리: an admin took the member's app down (with the
  reason), or closed a report keeping it.

Gone since owner-polish-3: the daily spend summaries and the spend
milestones — the toast and Usage already say what was spent. Rows of those
kinds that still exist are hidden (`VISIBLE_KINDS`) and pruned with the
rest after `KEEP_DAYS`.

Reading: newest first, at most `LIST_LIMIT`; rows older than `KEEP_DAYS`
are deleted for that member on each read. Opening the bell marks what it
shows read (the badge goes); 지우기 deletes the rows shown — no history is
kept on purpose. A member sees only their own — someone else's id is a
404, like any owned thing.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import BuilderProject, Notification, Quarter, QuarterApplication, User
from app.services.chat_limits import KST

KEEP_DAYS = 90
LIST_LIMIT = 50
#: What the list and the badge show. Older kinds ("spend", "milestone")
#: stay in the table until pruned but never reach a screen.
VISIBLE_KINDS = ("publish", "application", "reaction", "app_report")

REACTION_WORD = {"like": "좋아요", "useful": "유용해요", "interesting": "흥미로워요"}


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


def _kst_day(moment: datetime) -> date:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(KST).date()


_COUNT = re.compile(r"반응 (\d+)개")


def reaction_received(
    db: Session,
    *,
    owner_id: int | None,
    actor_id: int,
    item_kind: str,
    item_id: int,
    item_label: str,
    what: str,
    link: str | None,
    now: datetime | None = None,
) -> Notification | None:
    """반응을 얻었어요 — one row per (item, KST day) that counts up.

    `what` is a reaction kind ("like" …), "comment" or "reply". Nothing
    for the member's own reaction on their own thing, and nothing when
    the item has no owner (the club's own video). Does not commit."""
    if owner_id is None or owner_id == actor_id:
        return None
    moment = now or datetime.now(timezone.utc)
    key = f"reaction:{item_kind}:{item_id}:{_kst_day(moment).isoformat()}"
    word = REACTION_WORD.get(what, "댓글" if what == "comment" else "답글" if what == "reply" else what)
    existing = db.scalar(
        select(Notification).where(Notification.user_id == owner_id, Notification.dedupe_key == key)
    )
    if existing is not None:
        found = _COUNT.search(existing.title)
        count = (int(found.group(1)) if found else 1) + 1
        existing.title = f"'{item_label}'이(가) 오늘 반응 {count}개를 얻었어요"[:200]
        existing.body = f"방금: {word}"[:600]
        existing.created_at = moment
        existing.read_at = None  # new since it was last seen
        db.flush()
        return existing
    return notify(
        db, owner_id, "reaction",
        f"'{item_label}'이(가) 오늘 반응 1개를 얻었어요",
        f"방금: {word}", link,
        dedupe_key=key,
    )


# ------------------------------------------------------------ reading


def refresh(db: Session, user: User) -> None:
    """What every read does first: drop old rows. Commits — the caller
    reads afterwards."""
    prune(db, user.id)
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
            .where(Notification.user_id == user.id, Notification.kind.in_(VISIBLE_KINDS))
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(limit)
        )
    )


def unread_count(db: Session, user_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
                Notification.kind.in_(VISIBLE_KINDS),
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


def clear(db: Session, user_id: int, ids: list[int] | None = None) -> int:
    """지우기: delete the member's rows — the ones shown (`ids`), or all.
    No history is kept on purpose (owner-polish-3 (c2))."""
    statement = delete(Notification).where(Notification.user_id == user_id)
    if ids is not None:
        if not ids:
            return 0
        statement = statement.where(Notification.id.in_(ids))
    result = db.execute(statement.execution_options(synchronize_session="fetch"))
    return result.rowcount or 0
