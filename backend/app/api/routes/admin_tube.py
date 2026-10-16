"""Admin › Content — 신고 of CtrlAITube comments (promo-videos).

The same queue as app reports: hide or delete the comment with a reason
(audited, closes its open reports), or close a report and keep it.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import TubeComment, TubeVideo, User
from app.schemas.tube import TubeAdminAction, TubeReportRead, TubeResolve
from app.services import tube

router = APIRouter(prefix="/admin/tube", tags=["admin"])


@router.get("/reports", response_model=list[TubeReportRead], summary="Open comment reports, oldest first")
def list_reports(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[TubeReportRead]:
    out = []
    for row in tube.open_reports(db):
        comment = db.get(TubeComment, row.comment_id) if row.comment_id is not None else None
        video = db.get(TubeVideo, comment.video_id) if comment else None
        reporter = db.get(User, row.reporter_id) if row.reporter_id else None
        author = db.get(User, comment.user_id) if comment and comment.user_id else None
        out.append(
            TubeReportRead(
                id=row.id,
                comment_id=row.comment_id,
                video_slug=video.slug if video else "",
                video_title=video.title if video else "",
                reason=row.reason,
                excerpt=row.excerpt,
                reporter_username=reporter.username if reporter else "",
                author_username=author.username if author else "",
                created_at=row.created_at,
                comment_live=comment is not None and comment.deleted_at is None and comment.hidden_at is None,
            )
        )
    return out


def _run(db: Session, action) -> dict:
    closed = action()  # a TubeError becomes its status in app.main
    db.commit()
    return {"detail": "처리했어요.", "reports_closed": closed}


@router.post("/comments/{comment_id}/hide", response_model=dict, summary="Hide a comment for everyone (audited)")
def hide_comment(
    comment_id: int, payload: TubeAdminAction, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> dict:
    return _run(db, lambda: tube.admin_hide(db, admin, comment_id, payload.reason))


@router.post("/comments/{comment_id}/delete", response_model=dict, summary="Delete a comment for good (audited)")
def delete_comment(
    comment_id: int, payload: TubeAdminAction, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> dict:
    return _run(db, lambda: tube.admin_delete(db, admin, comment_id, payload.reason))


@router.post("/reports/{report_id}/resolve", response_model=dict, summary="Close a report and keep the comment (audited)")
def resolve_report(
    report_id: int, payload: TubeResolve, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> dict:
    tube.resolve_report(db, admin, report_id, payload.note)
    db.commit()
    return {"detail": "신고를 닫았어요."}
