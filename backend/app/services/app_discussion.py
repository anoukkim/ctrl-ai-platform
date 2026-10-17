"""CtrlAIApps reactions and comments (ctrlaiapps-reactions).

CtrlAITube's rules (services/tube.py), for a published app:

* The app is read through the published listing only — a deleted or
  unpublished project is a 404, so its reactions and comments disappear
  with it (CLAUDE.md §10). Deleted and hidden comments are absent.
* Reading needs a signed-in account; reacting and commenting need a member
  taking part this quarter (the route's `require_active_member`). A
  comment is its author's: anyone else's edit or delete is a 404.
* 신고 reaches Admin › Content; the admin hides or deletes a comment with
  a reason (audited), which closes its open reports.
* 반응을 얻었어요: the app's maker hears of reactions (one member once a
  day) and comments; a comment's author hears of a reply.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AppComment, AppCommentReport, AppReaction, AuditAction, BuilderProject, User
from app.services import app_publish, audit, notifications
from app.services.tube import EXCERPT, MAX_COMMENT, MAX_REPORT, REACTION_KINDS, TubeError

NOT_FOUND = "앱을 찾을 수 없어요."
COMMENT_NOT_FOUND = "댓글을 찾을 수 없어요."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def published(db: Session, slug: str) -> BuilderProject:
    """A live, published app by its slug (the listing's own filter)."""
    project = db.scalar(app_publish.published_listing().where(BuilderProject.app_slug == slug))
    if project is None:
        raise TubeError(NOT_FOUND, 404)
    return project


def _live_project(db: Session, project_id: int) -> BuilderProject | None:
    return db.scalar(app_publish.published_listing().where(BuilderProject.id == project_id))


def _link(project: BuilderProject) -> str:
    return f"/ctrlaistore/{project.app_slug}"


# ---------------------------------------------------------------- reactions


def reaction_counts(db: Session, project: BuilderProject) -> dict[str, int]:
    rows = db.execute(
        select(AppReaction.kind, func.count(AppReaction.id))
        .where(AppReaction.project_id == project.id)
        .group_by(AppReaction.kind)
    ).all()
    counts = {kind: 0 for kind in REACTION_KINDS}
    for kind, n in rows:
        if kind in counts:
            counts[kind] = int(n or 0)
    return counts


def my_reactions(db: Session, project: BuilderProject, user: User) -> list[str]:
    return list(
        db.scalars(select(AppReaction.kind).where(AppReaction.project_id == project.id, AppReaction.user_id == user.id))
    )


def toggle_reaction(db: Session, project: BuilderProject, user: User, kind: str) -> bool:
    if kind not in REACTION_KINDS:
        raise TubeError("그런 반응은 없어요.")
    row = db.scalar(
        select(AppReaction).where(
            AppReaction.project_id == project.id, AppReaction.user_id == user.id, AppReaction.kind == kind
        )
    )
    if row is not None:
        db.delete(row)
        db.flush()
        return False
    try:
        with db.begin_nested():
            db.add(AppReaction(project_id=project.id, user_id=user.id, kind=kind))
            db.flush()
    except IntegrityError:
        return True
    notifications.reaction_received(
        db, owner_id=project.owner_user_id, actor_id=user.id, item_kind="app", item_id=project.id,
        item_label=project.name, what=kind, link=_link(project), token=f"r:{user.id}",
    )
    return True


# ----------------------------------------------------------------- comments


def _clean_body(body: object) -> str:
    text = str(body or "").replace("\r", "").strip()
    if not text:
        raise TubeError("댓글 내용을 적어 주세요.")
    if len(text) > MAX_COMMENT:
        raise TubeError(f"댓글은 {MAX_COMMENT:,}자까지 적을 수 있어요.")
    return text


def _visible(row: AppComment | None) -> bool:
    return row is not None and row.deleted_at is None and row.hidden_at is None


@dataclass
class CommentView:
    row: AppComment
    author: User | None
    replies: list["CommentView"]


def comment_tree(db: Session, project: BuilderProject) -> list[CommentView]:
    rows = list(
        db.scalars(
            select(AppComment)
            .where(AppComment.project_id == project.id, AppComment.deleted_at.is_(None), AppComment.hidden_at.is_(None))
            .order_by(AppComment.id)
        )
    )
    ids = {row.user_id for row in rows if row.user_id}
    authors = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids or {0})))}
    views = {row.id: CommentView(row, authors.get(row.user_id) if row.user_id else None, []) for row in rows}
    top: list[CommentView] = []
    for row in rows:
        parent = views.get(row.parent_id) if row.parent_id else None
        (parent.replies if parent else top).append(views[row.id])
    return top


def count_comments(db: Session, project: BuilderProject) -> int:
    return int(
        db.scalar(
            select(func.count(AppComment.id)).where(
                AppComment.project_id == project.id, AppComment.deleted_at.is_(None), AppComment.hidden_at.is_(None)
            )
        )
        or 0
    )


def add_comment(db: Session, project: BuilderProject, user: User, body: object, parent_id: int | None) -> AppComment:
    text = _clean_body(body)
    if parent_id is not None:
        parent = db.get(AppComment, parent_id)
        if not _visible(parent) or parent.project_id != project.id:
            raise TubeError(COMMENT_NOT_FOUND, 404)
        top = db.get(AppComment, parent.parent_id) if parent.parent_id else None
        parent_id = top.id if _visible(top) else parent.id
    row = AppComment(project_id=project.id, user_id=user.id, parent_id=parent_id, body=text)
    db.add(row)
    db.flush()
    notifications.reaction_received(
        db, owner_id=project.owner_user_id, actor_id=user.id, item_kind="app", item_id=project.id,
        item_label=project.name, what="reply" if parent_id else "comment", link=_link(project), token=f"c:{row.id}",
    )
    if parent_id is not None:
        parent = db.get(AppComment, parent_id)
        if parent is not None and parent.user_id is not None and parent.user_id != project.owner_user_id:
            notifications.reaction_received(
                db, owner_id=parent.user_id, actor_id=user.id, item_kind="app_comment", item_id=parent.id,
                item_label=parent.body[:30], what="reply", link=_link(project), token=f"c:{row.id}",
            )
    return row


def own_comment(db: Session, user: User, comment_id: int) -> AppComment:
    row = db.get(AppComment, comment_id)
    if not _visible(row) or row.user_id != user.id:
        raise TubeError(COMMENT_NOT_FOUND, 404)
    # The app must still be on CtrlAIApps: a comment on a removed app is gone too.
    if _live_project(db, row.project_id) is None:
        raise TubeError(COMMENT_NOT_FOUND, 404)
    return row


def edit_comment(db: Session, user: User, comment_id: int, body: object) -> AppComment:
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


def report_comment(db: Session, reporter: User, comment_id: int, reason: object) -> AppCommentReport:
    text = " ".join(str(reason or "").split())
    if not text:
        raise TubeError("신고하는 이유를 적어 주세요.")
    if len(text) > MAX_REPORT:
        raise TubeError(f"신고 내용은 {MAX_REPORT}자까지 적을 수 있어요.")
    row = db.get(AppComment, comment_id)
    if not _visible(row):
        raise TubeError(COMMENT_NOT_FOUND, 404)
    if _live_project(db, row.project_id) is None:
        raise TubeError(NOT_FOUND, 404)
    existing = db.scalar(
        select(AppCommentReport).where(
            AppCommentReport.comment_id == row.id,
            AppCommentReport.reporter_id == reporter.id,
            AppCommentReport.resolved_at.is_(None),
        )
    )
    if existing is not None:
        raise TubeError("이미 신고를 받았어요. 관리자가 확인하고 있어요.", 409)
    report = AppCommentReport(comment_id=row.id, reporter_id=reporter.id, reason=text, excerpt=row.body[:EXCERPT])
    db.add(report)
    db.flush()
    return report


def open_reports(db: Session) -> list[AppCommentReport]:
    return list(
        db.scalars(select(AppCommentReport).where(AppCommentReport.resolved_at.is_(None)).order_by(AppCommentReport.id))
    )


def _close_reports(db: Session, admin: User, comment_id: int) -> int:
    rows = list(
        db.scalars(
            select(AppCommentReport).where(
                AppCommentReport.comment_id == comment_id, AppCommentReport.resolved_at.is_(None)
            )
        )
    )
    for row in rows:
        row.resolved_at = _now()
        row.resolved_by = admin.id
    return len(rows)


def admin_hide(db: Session, admin: User, comment_id: int, reason: str) -> int:
    row = db.get(AppComment, comment_id)
    if not _visible(row):
        raise TubeError(COMMENT_NOT_FOUND, 404)
    reason = " ".join(reason.split())
    if not reason:
        raise TubeError("숨기는 이유를 적어 주세요.")
    row.hidden_at = _now()
    row.hidden_reason = reason[:200]
    closed = _close_reports(db, admin, row.id)
    audit.record(
        db, actor=admin, action=AuditAction.APP_COMMENT_HIDDEN, target_type="app_comment", target_id=row.id,
        target_label=row.body[:60], summary=f"앱 댓글 {row.id} 숨김: {reason}",
        detail={"project_id": row.project_id, "reason": reason, "excerpt": row.body[:EXCERPT], "reports_closed": closed},
    )
    return closed


def admin_delete(db: Session, admin: User, comment_id: int, reason: str) -> int:
    row = db.get(AppComment, comment_id)
    if row is None:
        raise TubeError(COMMENT_NOT_FOUND, 404)
    reason = " ".join(reason.split())
    if not reason:
        raise TubeError("지우는 이유를 적어 주세요.")
    closed = _close_reports(db, admin, row.id)
    audit.record(
        db, actor=admin, action=AuditAction.APP_COMMENT_DELETED, target_type="app_comment", target_id=row.id,
        target_label=row.body[:60], summary=f"앱 댓글 {row.id} 삭제: {reason}",
        detail={"project_id": row.project_id, "reason": reason, "excerpt": row.body[:EXCERPT], "reports_closed": closed},
    )
    for reply in db.scalars(select(AppComment).where(AppComment.parent_id == row.id)):
        closed += _close_reports(db, admin, reply.id)
        db.delete(reply)
    db.delete(row)
    db.flush()
    return closed


def resolve_report(db: Session, admin: User, report_id: int, note: str) -> None:
    row = db.get(AppCommentReport, report_id)
    if row is None or row.resolved_at is not None:
        raise TubeError("그 신고를 찾을 수 없어요.", 404)
    row.resolved_at = _now()
    row.resolved_by = admin.id
    audit.record(
        db, actor=admin, action=AuditAction.APP_COMMENT_REPORT_RESOLVED, target_type="app_comment_report",
        target_id=row.id, target_label=row.excerpt[:60],
        summary=f"앱 댓글 신고 {row.id} 처리(댓글 유지)" + (f" · {note.strip()}" if note.strip() else ""),
        detail={"comment_id": row.comment_id, "note": note.strip()},
    )
