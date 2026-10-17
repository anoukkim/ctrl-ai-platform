"""background-runs (owner, 2026-10-17) — replies that outlive the page.

"채팅하다 중간에 나가면 계속 돌아가?" → "만약 나갔다면 채팅에 오로라로 점?
돌아가고 있다는거 보이게". A Chat reply keeps going on the server when the
member leaves the page or closes the tab; only 중지 stops it. The task
that talks to Claude (`routes.chat.send_message`'s `produce`) writes what
it has so far into a `ChatRun` row every half second and reads the
member's 중지 from it, because the api runs more than one worker process:
a second tab's 중지, a page coming back to the live reply and the running
dot all go through the database.

Money does not move here. The task charges each call through
`usage.charge()` exactly as before (`chat.settle_segment`); a page that
re-attaches only reads the row, so watching a reply twice never charges
it twice. One running reply per member at a time (a partial unique
index). A run whose heartbeat stopped — the server restarted under it —
is ended as 중지 with what was written and **not charged** (the call's
real usage died with the process; the club absorbs it).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text, update
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    BuilderGeneration,
    BuilderProject,
    ChatMessage,
    ChatMessageStatus,
    ChatRole,
    ChatRun,
    Conversation,
    User,
)

#: How often the task writes what it has (and reads 중지).
FLUSH_SECONDS = 0.5
#: A run whose heartbeat is older than this *may* be gone; it is ended only
#: when its liveness lock is free too (PostgreSQL, `hold`).
STALE = timedelta(seconds=45)
#: Without the lock (SQLite), a build is ended only after the Builder's own
#: 15 minutes (`builder_stages.STALE_RUN`).
BUILD_STALE = timedelta(minutes=15)

ONE_AT_A_TIME = "다른 대화에서 답장을 쓰고 있어요. 그 답장이 끝나거나 중지한 뒤에 보내 주세요."
RESTARTED_NOTE = "서버가 다시 시작되어 여기서 멈췄어요. 마지막으로 쓰던 부분은 청구되지 않았어요."
BUILD_RESTARTED = "서버가 다시 시작되어 만들기가 멈췄어요. 이어서 만들기로 계속할 수 있어요."


#: PostgreSQL advisory-lock classes: a running reply / build holds its lock
#: on a connection of its own for as long as it runs.
CHAT_LOCK = 71001
BUILD_LOCK = 71002


def _postgres(bind) -> bool:
    return getattr(getattr(bind, "dialect", None), "name", "") == "postgresql"


def hold(bind, kind: int, object_id: int) -> Connection | None:
    """Take the run's liveness lock on a dedicated connection and keep it.

    A run is alive while this lock is held: the connection closes when its
    process dies (a restart, a crash), which releases the lock — so the
    sweep can tell a dead run from a slow one (a heartbeat late because the
    pool or the event loop was busy), which a heartbeat's age cannot.
    None off PostgreSQL (the tests' SQLite), where the heartbeat decides."""
    if not _postgres(bind):
        return None
    engine = getattr(bind, "engine", bind)
    connection = engine.connect()
    try:
        connection.execute(text("SELECT pg_advisory_lock(:k, :o)"), {"k": kind, "o": object_id})
        connection.commit()
    except Exception:
        connection.close()
        raise
    return connection


def release(connection: Connection | None, kind: int, object_id: int) -> None:
    if connection is None:
        return
    try:
        connection.execute(text("SELECT pg_advisory_unlock(:k, :o)"), {"k": kind, "o": object_id})
        connection.commit()
    finally:
        connection.close()


@contextmanager
def alive(bind, kind: int, object_id: int) -> Iterator[None]:
    connection = hold(bind, kind, object_id)
    try:
        yield
    finally:
        release(connection, kind, object_id)


def _dead(db: Session, kind: int, object_id: int) -> bool:
    """True when nobody holds the run's liveness lock (PostgreSQL); off it,
    the heartbeat's age alone decides."""
    if not _postgres(db.get_bind()):
        return True
    taken = bool(db.scalar(text("SELECT pg_try_advisory_lock(:k, :o)"), {"k": kind, "o": object_id}))
    if taken:
        db.execute(text("SELECT pg_advisory_unlock(:k, :o)"), {"k": kind, "o": object_id})
    return taken


class RunRefused(Exception):
    """Another reply of this member is still running."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def is_fresh(run: ChatRun, now: datetime | None = None) -> bool:
    heartbeat = _aware(run.heartbeat_at)
    return heartbeat is not None and (now or _now()) - heartbeat < STALE


# ------------------------------------------------------------ the task's side


def begin(db: Session, user: User, conversation: Conversation) -> ChatRun:
    """The member's one running reply, or `RunRefused`. Commits."""
    sweep(db, user_id=user.id)
    run = ChatRun(user_id=user.id, conversation_id=conversation.id, status="running", heartbeat_at=_now())
    db.add(run)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise RunRefused(ONE_AT_A_TIME) from error
    return run


def abandon(db: Session, run_id: int) -> None:
    """The turn was refused before Claude was called: no run. Commits."""
    db.execute(update(ChatRun).where(ChatRun.id == run_id).values(status="failed", finished_at=_now()))
    db.commit()


def attach_user_message(db: Session, run_id: int, message_id: int) -> None:
    db.execute(update(ChatRun).where(ChatRun.id == run_id).values(user_message_id=message_id))
    db.commit()


def flush(db: Session, run_id: int, shown: str, thinking: str) -> bool:
    """Write what the reply has so far and the heartbeat; True when the
    reply must stop — 중지 was asked for (from any page), or the row is no
    longer running (it was ended under it). Commits."""
    db.execute(
        update(ChatRun)
        .where(ChatRun.id == run_id, ChatRun.status == "running")
        .values(text=shown, thinking=thinking, heartbeat_at=_now())
    )
    row = db.execute(select(ChatRun.stop_requested, ChatRun.status).where(ChatRun.id == run_id)).first()
    db.commit()
    return row is None or bool(row.stop_requested) or row.status != "running"


def finish(db: Session, run_id: int, status: str, *, message_id: int | None, text: str, thinking: str, error: str = "") -> None:
    """The reply is saved (or failed): the row says how it ended. Commits."""
    db.execute(
        update(ChatRun)
        .where(ChatRun.id == run_id, ChatRun.status == "running")
        .values(
            status=status,
            message_id=message_id,
            text=text,
            thinking=thinking,
            error=error[:300],
            finished_at=_now(),
            heartbeat_at=_now(),
        )
    )
    db.commit()


# ------------------------------------------------------------ the pages' side


def current(db: Session, user: User, conversation_id: int) -> ChatRun | None:
    """The live run of this conversation, if one is still going."""
    sweep(db, user_id=user.id)
    return db.scalar(
        select(ChatRun).where(
            ChatRun.user_id == user.id, ChatRun.conversation_id == conversation_id, ChatRun.status == "running"
        )
    )


def request_stop(db: Session, user: User, conversation_id: int) -> ChatRun | None:
    """중지 — from this page or another. Commits."""
    run = current(db, user, conversation_id)
    if run is None:
        return None
    run.stop_requested = True
    db.commit()
    return run


@dataclass
class Running:
    conversations: list[int]
    projects: list[int]


def running_for(db: Session, user: User) -> Running:
    """What the running dots show: the member's live reply and builds."""
    sweep(db, user_id=user.id)
    conversations = list(
        db.scalars(select(ChatRun.conversation_id).where(ChatRun.user_id == user.id, ChatRun.status == "running"))
    )
    cutoff = _now() - STALE
    projects = list(
        db.scalars(
            select(BuilderGeneration.project_id)
            .join(BuilderProject, BuilderProject.id == BuilderGeneration.project_id)
            .where(
                BuilderProject.owner_user_id == user.id,
                BuilderProject.deleted_at.is_(None),
                BuilderGeneration.status == "running",
                BuilderGeneration.heartbeat_at.is_not(None),
                BuilderGeneration.heartbeat_at >= cutoff,
            )
        ).unique()
    )
    return Running(conversations=conversations, projects=projects)


# ------------------------------------------------------------ restarts


def sweep(db: Session, *, user_id: int | None = None) -> int:
    """End what a restart left running: a reply is saved as 중지 with the
    text it had (uncharged — see the module docstring); a build becomes
    이어서 만들기. Only rows whose heartbeat stopped, so a live run in the
    other worker process is never touched. Commits when it changed
    anything; returns how many it ended."""
    cutoff = _now() - STALE
    query = select(ChatRun).where(ChatRun.status == "running", ChatRun.heartbeat_at < cutoff)
    if user_id is not None:
        query = query.where(ChatRun.user_id == user_id)
    ended = 0
    for run in db.scalars(query.with_for_update(skip_locked=True)).all():
        if not _dead(db, CHAT_LOCK, run.id):
            continue  # slow, not dead: its process still holds it
        # Saved after all (the process died between saving and saying so):
        # point at that reply instead of saving a second one.
        saved = None
        if run.user_message_id is not None:
            saved = db.scalar(
                select(ChatMessage.id)
                .where(
                    ChatMessage.conversation_id == run.conversation_id,
                    ChatMessage.role == ChatRole.ASSISTANT,
                    ChatMessage.id > run.user_message_id,
                )
                .order_by(ChatMessage.id)
                .limit(1)
            )
        if saved is not None:
            run.status = "done"
            run.message_id = saved
            run.finished_at = _now()
            ended += 1
            continue
        message_id = None
        if run.text.strip() and db.get(Conversation, run.conversation_id) is not None:
            message = ChatMessage(
                conversation_id=run.conversation_id,
                user_id=run.user_id,
                role=ChatRole.ASSISTANT,
                content=run.text,
                status=ChatMessageStatus.STOPPED,
                thinking=run.thinking or None,
                stop_note=RESTARTED_NOTE,
            )
            db.add(message)
            db.flush()
            message_id = message.id
        run.status = "stopped"
        run.message_id = message_id
        run.finished_at = _now()
        ended += 1
    builds = select(BuilderGeneration).where(
        BuilderGeneration.status == "running",
        BuilderGeneration.heartbeat_at.is_not(None),
        BuilderGeneration.heartbeat_at < cutoff,
    )
    # Off PostgreSQL there is no liveness lock: a build keeps the old
    # 15-minute rule, so a slow build is never ended under its worker.
    if not _postgres(db.get_bind()):
        builds = builds.where(BuilderGeneration.heartbeat_at < _now() - BUILD_STALE)
    if user_id is not None:
        builds = builds.where(BuilderGeneration.user_id == user_id)
    for generation in db.scalars(builds.with_for_update(skip_locked=True)).all():
        if not _dead(db, BUILD_LOCK, generation.id):
            continue
        generation.status = "partial" if generation.files_done else "failed"
        generation.error = BUILD_RESTARTED
        ended += 1
    if ended:
        db.commit()
    return ended


def beat_generation(db: Session, generation_id: int) -> None:
    """The Builder run's heartbeat. Commits."""
    db.execute(
        update(BuilderGeneration)
        .where(BuilderGeneration.id == generation_id, BuilderGeneration.status == "running")
        .values(heartbeat_at=_now())
    )
    db.commit()
