"""Admin › Content — published apps and their reports (ctrlaiapps-publish).

The admin sees every app on CtrlAIApps with its open reports, can take an
app down (audited; its reports close) or close a report and keep the app
(audited). Taking down is 게시 취소 for the owner: every version stays
and they may publish again.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.api.routes.apps import listing_of
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AppReport, BuilderProject, User
from app.schemas.apps import AdminAppRead, AdminReportRead, AdminResolve, AdminUnpublish
from app.services import app_publish

router = APIRouter(prefix="/admin/apps", tags=["admin"])


@router.get("", response_model=list[AdminAppRead], summary="Every published app, with open reports")
def list_published(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> list[AdminAppRead]:
    counts = app_publish.open_report_counts(db)
    rows = db.scalars(
        app_publish.published_listing().order_by(BuilderProject.published_at.desc())
    )
    return [
        AdminAppRead(
            **listing_of(db, settings, row).model_dump(),
            owner_id=row.owner_user_id,
            open_reports=counts.get(row.id, 0),
        )
        for row in rows
    ]


@router.get("/reports", response_model=list[AdminReportRead], summary="Open reports, oldest first")
def list_reports(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[AdminReportRead]:
    rows = db.scalars(
        select(AppReport).where(AppReport.resolved_at.is_(None)).order_by(AppReport.created_at)
    )
    out = []
    for row in rows:
        project = db.get(BuilderProject, row.project_id)
        reporter = db.get(User, row.reporter_id) if row.reporter_id else None
        listed = (
            project is not None
            and project.deleted_at is None
            and project.published_version_id is not None
        )
        out.append(
            AdminReportRead(
                id=row.id,
                project_id=row.project_id,
                app_name=project.name if project else "(삭제된 앱)",
                app_slug=(project.app_slug or "") if project else "",
                reason=row.reason,
                reporter_username=reporter.username if reporter else "",
                created_at=row.created_at,
                still_listed=listed,
            )
        )
    return out


@router.post(
    "/{project_id}/unpublish",
    response_model=dict,
    summary="Take an app off CtrlAIApps (audited)",
)
def admin_unpublish(
    project_id: int,
    payload: AdminUnpublish,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    project = db.scalar(app_publish.published_listing().where(BuilderProject.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="게시된 앱이 아닙니다.")
    closed = app_publish.admin_unpublish(db, settings, admin, project, payload.reason)
    db.commit()
    return {"detail": "게시를 내렸습니다.", "reports_closed": closed}


@router.post(
    "/reports/{report_id}/resolve",
    response_model=dict,
    summary="Close a report and keep the app (audited)",
)
def resolve_report(
    report_id: int,
    payload: AdminResolve,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    row = db.get(AppReport, report_id)
    if row is None or row.resolved_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="열린 신고가 아닙니다.")
    app_publish.resolve_report(db, admin, row, payload.note)
    db.commit()
    return {"detail": "신고를 처리했습니다."}
