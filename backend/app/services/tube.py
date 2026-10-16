"""CtrlAITube — the club's promo video with real reactions and comments
(promo-videos; the first real rows of Phase 8).

Rules:

* Every read filters `deleted_at` (CLAUDE.md §10) and, for members,
  `hidden_at`; a deleted or hidden comment is simply absent.
* Reading needs a signed-in account; reacting and commenting need a member
  taking part this quarter (`require_active_member` in the route). A
  comment is the author's: another member's edit or delete is a 404.
* 신고 reaches Admin › Content; the admin hides or deletes a comment with a
  reason (audited), which closes its open reports.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AuditAction, TubeComment, TubeReaction, TubeReport, TubeVideo, User
from app.services import audit

REACTION_KINDS = ("like", "useful", "interesting")
MAX_COMMENT = 1000
MAX_REPORT = 500
EXCERPT = 200

#: The club's own video (promo-videos): two hosted files, served from the
#: site (frontend/public/promo). **Which file goes where is a matter of
#: place, not device** (owner, 2026-10-16, fix-promo-video-placement):
#: `hosted_desktop_src` is the 16:9 cut, played in the first-visit guide;
#: `hosted_mobile_src` is the 9:16 cut, played on CtrlAITube — on every
#: device. Versioned names: a new encode is a new name, so caches never
#: serve the old one.
OFFICIAL_SLUG = "ctrlai-intro"
OFFICIAL = dict(
    slug=OFFICIAL_SLUG,
    kind="hosted",
    title="CTRL+AI 한눈에 보기",
    description=(
        "1분 안에 보는 CTRL+AI — 코딩을 몰라도 말만 하면 앱과 영상을 만들고 나눌 수 있어요. "
        "로그인, Chat, Project Builder, CtrlAIApps, 분기마다 받는 동아리 지원금까지. "
        "음악은 직접 만든 곡이에요. 가로 편은 처음 왔을 때의 안내 창에서 볼 수 있어요."
    ),
    official=True,
    hosted_desktop_src="/promo/ctrlai-intro-desktop-v1.mp4",
    hosted_mobile_src="/promo/ctrlai-intro-mobile-v1.mp4",
    poster_desktop_src="/promo/ctrlai-intro-desktop-v1.jpg",
    poster_mobile_src="/promo/ctrlai-intro-mobile-poster-v2.jpg",
    duration_seconds=60,
)


class TubeError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


NOT_FOUND = "영상을 찾을 수 없어요."
COMMENT_NOT_FOUND = "댓글을 찾을 수 없어요."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_official(db: Session) -> TubeVideo:
    """The club's video row, made on first use (idempotent, race-safe) and
    kept in step with OFFICIAL: a new encode or wording lands by deploy,
    with no data migration — the row is updated on the next read."""
    row = db.scalar(select(TubeVideo).where(TubeVideo.slug == OFFICIAL_SLUG))
    if row is not None:
        changed = False
        for key, value in OFFICIAL.items():
            if getattr(row, key) != value:
                setattr(row, key, value)
                changed = True
        if changed:
            db.flush()
        return row
    try:
        with db.begin_nested():
            row = TubeVideo(**OFFICIAL)
            db.add(row)
            db.flush()
    except IntegrityError:
        row = db.scalar(select(TubeVideo).where(TubeVideo.slug == OFFICIAL_SLUG))
    assert row is not None
    return row


def list_videos(db: Session) -> list[TubeVideo]:
    """Live videos, the official one first, then newest first."""
    ensure_official(db)
    return list(
        db.scalars(
            select(TubeVideo)
            .where(TubeVideo.deleted_at.is_(None))
            .order_by(TubeVideo.official.desc(), TubeVideo.published_at.desc(), TubeVideo.id.desc())
        )
    )


def get_video(db: Session, slug: str) -> TubeVideo:
    ensure_official(db)
    row = db.scalar(select(TubeVideo).where(TubeVideo.slug == slug, TubeVideo.deleted_at.is_(None)))
    if row is None:
        raise TubeError(NOT_FOUND, 404)
    return row


# ---------------------------------------------------------------- reactions


def reaction_counts(db: Session, video: TubeVideo) -> dict[str, int]:
    rows = db.execute(
        select(TubeReaction.kind, func.count(TubeReaction.id))
        .where(TubeReaction.video_id == video.id)
        .group_by(TubeReaction.kind)
    ).all()
    counts = {kind: 0 for kind in REACTION_KINDS}
    for kind, n in rows:
        if kind in counts:
            counts[kind] = int(n or 0)
    return counts


def my_reactions(db: Session, video: TubeVideo, user: User | None) -> list[str]:
    if user is None:
        return []
    return list(
        db.scalars(select(TubeReaction.kind).where(TubeReaction.video_id == video.id, TubeReaction.user_id == user.id))
    )


def toggle_reaction(db: Session, video: TubeVideo, user: User, kind: str) -> bool:
    """Press once: on; press again: off. Returns the new state."""
    if kind not in REACTION_KINDS:
        raise TubeError("그런 반응은 없어요.")
    row = db.scalar(
        select(TubeReaction).where(
            TubeReaction.video_id == video.id, TubeReaction.user_id == user.id, TubeReaction.kind == kind
        )
    )
    if row is not None:
        db.delete(row)
        db.flush()
        return False
    try:
        with db.begin_nested():
            db.add(TubeReaction(video_id=video.id, user_id=user.id, kind=kind))
            db.flush()
    except IntegrityError:
        return True  # a double press raced itself: it is on
    return True


# ----------------------------------------------------------------- comments


def _clean_body(body: object) -> str:
    text = " ".join(str(body or "").split("\r"))
    text = text.strip()
    if not text:
        raise TubeError("댓글 내용을 적어 주세요.")
    if len(text) > MAX_COMMENT:
        raise TubeError(f"댓글은 {MAX_COMMENT:,}자까지 적을 수 있어요.")
    return text


def _live(db: Session, video: TubeVideo) -> list[TubeComment]:
    return list(
        db.scalars(
            select(TubeComment)
            .where(TubeComment.video_id == video.id, TubeComment.deleted_at.is_(None), TubeComment.hidden_at.is_(None))
            .order_by(TubeComment.id)
        )
    )


@dataclass
class CommentView:
    row: TubeComment
    author: User | None
    replies: list["CommentView"]


def comment_tree(db: Session, video: TubeVideo) -> list[CommentView]:
    """Top-level comments in order, each with its replies. A reply whose
    parent is gone is kept at the top level rather than lost."""
    rows = _live(db, video)
    authors = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_({r.user_id for r in rows if r.user_id} or {0})))
    }
    views = {row.id: CommentView(row, authors.get(row.user_id) if row.user_id else None, []) for row in rows}
    top: list[CommentView] = []
    for row in rows:
        view = views[row.id]
        parent = views.get(row.parent_id) if row.parent_id else None
        (parent.replies if parent else top).append(view)
    return top


def authors_in(tree: list[CommentView]) -> list[User]:
    """Every author in a comment tree, once each."""
    seen: dict[int, User] = {}

    def walk(views: list[CommentView]) -> None:
        for view in views:
            if view.author is not None:
                seen.setdefault(view.author.id, view.author)
            walk(view.replies)

    walk(tree)
    return list(seen.values())


def count_comments(db: Session, video: TubeVideo) -> int:
    return int(
        db.scalar(
            select(func.count(TubeComment.id)).where(
                TubeComment.video_id == video.id, TubeComment.deleted_at.is_(None), TubeComment.hidden_at.is_(None)
            )
        )
        or 0
    )


def add_comment(db: Session, video: TubeVideo, user: User, body: object, parent_id: int | None) -> TubeComment:
    text = _clean_body(body)
    if parent_id is not None:
        parent = db.get(TubeComment, parent_id)
        if (
            parent is None
            or parent.video_id != video.id
            or parent.deleted_at is not None
            or parent.hidden_at is not None
        ):
            raise TubeError(COMMENT_NOT_FOUND, 404)
        # One level only: a reply to a reply hangs under the same top-level
        # comment — unless that one is gone (deleted or hidden), in which
        # case the reply the member answered is itself shown at the top, and
        # the new comment hangs under it.
        top = db.get(TubeComment, parent.parent_id) if parent.parent_id else None
        parent_id = top.id if top is not None and top.deleted_at is None and top.hidden_at is None else parent.id
    row = TubeComment(video_id=video.id, user_id=user.id, parent_id=parent_id, body=text)
    db.add(row)
    db.flush()
    return row


def own_comment(db: Session, user: User, comment_id: int) -> TubeComment:
    """The member's own live comment — anyone else's is a 404, so a member
    cannot tell whether another's comment exists by its id."""
    row = db.get(TubeComment, comment_id)
    if row is None or row.user_id != user.id or row.deleted_at is not None or row.hidden_at is not None:
        raise TubeError(COMMENT_NOT_FOUND, 404)
    return row


def edit_comment(db: Session, user: User, comment_id: int, body: object) -> TubeComment:
    row = own_comment(db, user, comment_id)
    row.body = _clean_body(body)
    row.updated_at = _now()
    db.flush()
    return row


def delete_comment(db: Session, user: User, comment_id: int) -> None:
    row = own_comment(db, user, comment_id)
    row.deleted_at = _now()
    db.flush()


# ------------------------------------------------------------------ reports


def report_comment(db: Session, reporter: User, comment_id: int, reason: object) -> TubeReport:
    """신고: any signed-in member, one open report per member per comment."""
    text = " ".join(str(reason or "").split())
    if not text:
        raise TubeError("신고하는 이유를 적어 주세요.")
    if len(text) > MAX_REPORT:
        raise TubeError(f"신고 내용은 {MAX_REPORT}자까지 적을 수 있어요.")
    row = db.get(TubeComment, comment_id)
    if row is None or row.deleted_at is not None or row.hidden_at is not None:
        raise TubeError(COMMENT_NOT_FOUND, 404)
    video = db.get(TubeVideo, row.video_id)
    if video is None or video.deleted_at is not None:
        raise TubeError(NOT_FOUND, 404)
    existing = db.scalar(
        select(TubeReport).where(
            TubeReport.comment_id == row.id, TubeReport.reporter_id == reporter.id, TubeReport.resolved_at.is_(None)
        )
    )
    if existing is not None:
        raise TubeError("이미 신고를 받았어요. 관리자가 확인하고 있어요.", 409)
    report = TubeReport(comment_id=row.id, reporter_id=reporter.id, reason=text, excerpt=row.body[:EXCERPT])
    db.add(report)
    db.flush()
    return report


def open_reports(db: Session) -> list[TubeReport]:
    return list(db.scalars(select(TubeReport).where(TubeReport.resolved_at.is_(None)).order_by(TubeReport.id)))


def _close_reports(db: Session, admin: User, comment_id: int) -> int:
    rows = list(
        db.scalars(select(TubeReport).where(TubeReport.comment_id == comment_id, TubeReport.resolved_at.is_(None)))
    )
    for row in rows:
        row.resolved_at = _now()
        row.resolved_by = admin.id
    return len(rows)


def admin_hide(db: Session, admin: User, comment_id: int, reason: str) -> int:
    row = db.get(TubeComment, comment_id)
    if row is None or row.deleted_at is not None or row.hidden_at is not None:
        raise TubeError(COMMENT_NOT_FOUND, 404)
    reason = " ".join(reason.split())
    if not reason:
        raise TubeError("숨기는 이유를 적어 주세요.")
    row.hidden_at = _now()
    row.hidden_reason = reason[:200]
    closed = _close_reports(db, admin, row.id)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.TUBE_COMMENT_HIDDEN,
        target_type="tube_comment",
        target_id=row.id,
        target_label=row.body[:60],
        summary=f"영상 댓글 {row.id} 숨김: {reason}",
        detail={"video_id": row.video_id, "reason": reason, "excerpt": row.body[:EXCERPT], "reports_closed": closed},
    )
    return closed


def admin_delete(db: Session, admin: User, comment_id: int, reason: str) -> int:
    row = db.get(TubeComment, comment_id)
    if row is None:
        raise TubeError(COMMENT_NOT_FOUND, 404)
    reason = " ".join(reason.split())
    if not reason:
        raise TubeError("지우는 이유를 적어 주세요.")
    closed = _close_reports(db, admin, row.id)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.TUBE_COMMENT_DELETED,
        target_type="tube_comment",
        target_id=row.id,
        target_label=row.body[:60],
        summary=f"영상 댓글 {row.id} 삭제: {reason}",
        detail={"video_id": row.video_id, "reason": reason, "excerpt": row.body[:EXCERPT], "reports_closed": closed},
    )
    # Replies go with it; the reports stay (comment_id → NULL) with their excerpt.
    for reply in db.scalars(select(TubeComment).where(TubeComment.parent_id == row.id)):
        closed += _close_reports(db, admin, reply.id)
        db.delete(reply)
    db.delete(row)
    db.flush()
    return closed


def resolve_report(db: Session, admin: User, report_id: int, note: str) -> None:
    row = db.get(TubeReport, report_id)
    if row is None or row.resolved_at is not None:
        raise TubeError("그 신고를 찾을 수 없어요.", 404)
    row.resolved_at = _now()
    row.resolved_by = admin.id
    audit.record(
        db,
        actor=admin,
        action=AuditAction.TUBE_REPORT_RESOLVED,
        target_type="tube_report",
        target_id=row.id,
        target_label=row.excerpt[:60],
        summary=f"영상 댓글 신고 {row.id} 처리(댓글 유지)" + (f" · {note.strip()}" if note.strip() else ""),
        detail={"comment_id": row.comment_id, "note": note.strip()},
    )
