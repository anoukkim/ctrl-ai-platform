"""Admin › Content — published apps and their reports (ctrlaiapps-publish).

The admin sees every app on CtrlAIApps with its open reports, can take an
app down (audited; its reports close) or close a report and keep the app
(audited). Taking down is 게시 취소 for the owner: every version stays
and they may publish again.
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin
from app.api.routes.apps import listing_of
from app.api.routes.builder import build_bundle, handoff_read
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import (
    AppConsent,
    AppDataCollection,
    AppDataItem,
    AppReport,
    AuditAction,
    BuilderProject,
    UsageEvent,
    UsageFeature,
    User,
    UserRole,
)
from app.schemas.apps import (
    AdminAppAiRead,
    AdminAppOverview,
    AdminAppRead,
    AdminDataAction,
    AdminDataCollectionRead,
    AdminDataItemRead,
    AdminDataRead,
    AdminReportRead,
    AdminResolve,
    AdminSdkSet,
    AdminUnpublish,
)
from app.schemas.builder import HandoffRead
from app.services import app_data, app_publish, app_runtime, audit, chat_limits, project_handoff
from app.services.quarters import current_quarter

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
    out = []
    for row in rows:
        usage = app_data.app_usage(db, row)
        out.append(
            AdminAppRead(
                **listing_of(db, settings, row).model_dump(),
                owner_id=row.owner_user_id,
                open_reports=counts.get(row.id, 0),
                example=_is_example(db.get(User, row.owner_user_id)),
                sdk_enabled=row.sdk_disabled_at is None,
                sdk_disabled_reason=row.sdk_disabled_reason,
                data_items=usage["items"],
                data_bytes=usage["bytes"],
            )
        )
    return out


# ------------------------------------------------- P4b: Admin › Apps


@dataclass(frozen=True)
class _Figures:
    """Everything the overview needs, gathered in a handful of grouped
    queries rather than one set per app (the list is every published or
    used project)."""

    owners: dict[int, User]
    consents: dict[int, int]
    data: dict[int, tuple[int, int]]
    #: (project_id, feature) → (calls, krw) this quarter; today for app_ai only.
    quarter: dict[tuple[int, str], tuple[int, int]]
    today: dict[int, tuple[int, int]]
    reports: dict[int, int]


def _tally(db: Session, *where) -> dict:
    rows = db.execute(
        select(
            UsageEvent.builder_project_id,
            UsageEvent.feature,
            func.count(UsageEvent.id),
            func.coalesce(func.sum(UsageEvent.charged_krw), 0),
        )
        .where(UsageEvent.builder_project_id.is_not(None), *where)
        .group_by(UsageEvent.builder_project_id, UsageEvent.feature)
    ).all()
    return {(pid, feature): (int(calls or 0), int(krw or 0)) for pid, feature, calls, krw in rows}


def _figures(db: Session, projects: list[BuilderProject]) -> _Figures:
    ids = [p.id for p in projects] or [0]
    app_features = [UsageFeature.APP_AI.value, UsageFeature.APP_AI_PREVIEW.value]
    # The ledger is attributed per quarter (CLAUDE.md §8): filter by it,
    # not by a date — a quarter starts at KST midnight, not UTC's.
    quarter = current_quarter(db)
    quarter_rows = (
        _tally(db, UsageEvent.builder_project_id.in_(ids), UsageEvent.feature.in_(app_features), UsageEvent.quarter_id == quarter.id)
        if quarter
        else {}
    )
    today_rows = _tally(
        db,
        UsageEvent.builder_project_id.in_(ids),
        UsageEvent.feature == UsageFeature.APP_AI.value,
        UsageEvent.created_at >= chat_limits.kst_day_start(),
    )
    owner_ids = {p.owner_user_id for p in projects}
    owners = {u.id: u for u in db.scalars(select(User).where(User.id.in_(owner_ids or {0})))}
    consents = {
        pid: int(n or 0)
        for pid, n in db.execute(
            select(AppConsent.project_id, func.count(AppConsent.id))
            .where(AppConsent.project_id.in_(ids), AppConsent.revoked_at.is_(None))
            .group_by(AppConsent.project_id)
        ).all()
    }
    data = {
        pid: (int(n or 0), int(size or 0))
        for pid, n, size in db.execute(
            select(AppDataItem.project_id, func.count(AppDataItem.id), func.coalesce(func.sum(AppDataItem.size_bytes), 0))
            .where(AppDataItem.project_id.in_(ids), AppDataItem.space == app_data.space_of("app"))
            .group_by(AppDataItem.project_id)
        ).all()
    }
    return _Figures(
        owners=owners,
        consents=consents,
        data=data,
        quarter=quarter_rows,
        today={pid: value for (pid, _feature), value in today_rows.items()},
        reports=app_publish.open_report_counts(db),
    )


def _overview(settings: Settings, project: BuilderProject, figures: _Figures) -> AdminAppOverview:
    owner = figures.owners.get(project.owner_user_id)
    published = project.published_version_id is not None
    today_calls, today_krw = figures.today.get(project.id, (0, 0))
    quarter_calls, quarter_krw = figures.quarter.get((project.id, UsageFeature.APP_AI.value), (0, 0))
    preview_calls, preview_krw = figures.quarter.get((project.id, UsageFeature.APP_AI_PREVIEW.value), (0, 0))
    items, size = figures.data.get(project.id, (0, 0))
    return AdminAppOverview(
        id=project.id,
        name=project.name,
        published=published,
        slug=project.app_slug if published else None,
        app_url=app_runtime.public_url(settings, project),
        version_number=project.published_version.number if published and project.published_version else None,
        published_at=project.published_at if published else None,
        owner_id=project.owner_user_id,
        owner_username=owner.username if owner else "",
        owner_name=owner.display_name if owner else "탈퇴 회원",
        example=_is_example(owner),
        sdk_enabled=project.sdk_disabled_at is None,
        sdk_disabled_reason=project.sdk_disabled_reason,
        open_reports=figures.reports.get(project.id, 0),
        consents=figures.consents.get(project.id, 0),
        data_items=items,
        data_bytes=size,
        ai=AdminAppAiRead(
            today_calls=today_calls,
            today_krw=today_krw,
            quarter_calls=quarter_calls,
            quarter_krw=quarter_krw,
            preview_quarter_calls=preview_calls,
            preview_quarter_krw=preview_krw,
        ),
        updated_at=project.updated_at,
    )


@router.get("/overview", response_model=list[AdminAppOverview], summary="Admin › Apps: every app that uses the 기능 상자")
def list_overview(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> list[AdminAppOverview]:
    """Published apps, plus unpublished projects whose 기능 상자 has been
    used (a consent, or an AI call — the maker's 미리보기 counts). Deleted
    projects never appear (CLAUDE.md §10)."""
    used_ids = {
        row for row in db.scalars(select(AppConsent.project_id).distinct())
    } | {
        row
        for row in db.scalars(
            select(UsageEvent.builder_project_id)
            .where(UsageEvent.feature.in_([UsageFeature.APP_AI.value, UsageFeature.APP_AI_PREVIEW.value]))
            .distinct()
        )
        if row is not None
    }
    rows = list(
        db.scalars(
            select(BuilderProject)
            .options(selectinload(BuilderProject.published_version))
            .where(BuilderProject.deleted_at.is_(None))
            .where(or_(BuilderProject.published_version_id.is_not(None), BuilderProject.id.in_(used_ids or {0})))
            .order_by(BuilderProject.updated_at.desc())
        )
    )
    figures = _figures(db, rows)
    return [_overview(settings, row, figures) for row in rows]


def _is_example(owner: User | None) -> bool:
    """An example app is one an admin owns (`import_example_apps`)."""
    return owner is not None and owner.role is UserRole.ADMIN


@router.get(
    "/{project_id}/handoff",
    response_model=HandoffRead,
    summary="ZIP 미리보기: exactly what 프로젝트 내려받기 packs, for an example app",
)
def preview_handoff(
    project_id: int,
    version: project_handoff.Which = Query("published"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> HandoffRead:
    """Every file of the ZIP with its text, so the admin can check the
    README / CLAUDE.md / prompt read well (project-export-handoff).

    Example apps only — projects an admin owns. A member's project is not
    readable here: its HISTORY holds their own requests, and nothing about
    checking our templates needs them."""
    project = db.get(BuilderProject, project_id)
    if project is None or project.deleted_at is not None or not _is_example(db.get(User, project.owner_user_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="예시 앱을 찾을 수 없습니다.")
    return handoff_read(db, project, build_bundle(db, project, version, ""), with_content=True)


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
        item = db.get(AppDataItem, row.data_item_id) if row.data_item_id else None
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
                data_item_id=row.data_item_id,
                item_excerpt=row.item_excerpt,
                item_live=item is not None and item.hidden_at is None,
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


@router.post(
    "/{project_id}/sdk",
    response_model=dict,
    summary="기능 상자 정지 / 재개 for one app (audited)",
)
def set_sdk(
    project_id: int,
    payload: AdminSdkSet,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """The kill switch (app-platform P2): every `/_ctrlai/v1` call of the
    app is refused at once with a Korean message; the app itself still
    opens. Resuming clears it. A reason is required to stop."""
    project = db.get(BuilderProject, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="앱을 찾을 수 없습니다.")
    reason = " ".join(payload.reason.split())
    if not payload.enabled and not reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="멈추는 이유를 적어 주세요.")
    if payload.enabled:
        project.sdk_disabled_at = None
        project.sdk_disabled_reason = ""
        summary = f"앱 '{project.name}'의 기능 상자를 다시 켰습니다."
    else:
        project.sdk_disabled_at = datetime.now(timezone.utc)
        project.sdk_disabled_reason = reason
        summary = f"앱 '{project.name}'의 기능 상자를 멈췄습니다: {reason}"
    audit.record(
        db,
        actor=admin,
        action=AuditAction.APP_SDK_SET,
        target_type="app",
        target_id=project.id,
        target_label=project.name,
        summary=summary,
        detail={"enabled": payload.enabled, "reason": reason},
    )
    db.commit()
    return {"detail": "기능 상자를 다시 켰어요." if payload.enabled else "기능 상자를 멈췄어요.", "sdk_enabled": payload.enabled}


# --------------------------------------------------------- P3: ctrlai.db


@router.get("/{project_id}/data", response_model=AdminDataRead, summary="What an app holds in ctrlai.db")
def app_data_read(
    project_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> AdminDataRead:
    """The live app's collections with their sizes, and its **shared** items
    (what every visitor can see) newest first. Private items are the
    visitors' own and are never listed — only counted."""
    project = db.get(BuilderProject, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="앱을 찾을 수 없습니다.")
    collections = list(
        db.scalars(
            select(AppDataCollection)
            .where(AppDataCollection.project_id == project.id, AppDataCollection.space == "app")
            .order_by(AppDataCollection.name)
        )
    )
    by_id = {row.id: row for row in collections}
    sizes = {
        collection_id: (int(count), int(total or 0))
        for collection_id, count, total in db.execute(
            select(AppDataItem.collection_id, func.count(AppDataItem.id), func.sum(AppDataItem.size_bytes))
            .where(AppDataItem.project_id == project.id, AppDataItem.space == "app")
            .group_by(AppDataItem.collection_id)
        )
    }
    shared_ids = [row.id for row in collections if row.kind == app_data.SHARED]
    shared: list[AdminDataItemRead] = []
    if shared_ids:
        items = list(
            db.scalars(
                select(AppDataItem)
                .where(AppDataItem.collection_id.in_(shared_ids), AppDataItem.hidden_at.is_(None))
                .order_by(AppDataItem.id.desc())
                .limit(200)
            )
        )
        reports = dict(
            db.execute(
                select(AppReport.data_item_id, func.count(AppReport.id))
                .where(AppReport.data_item_id.in_([item.id for item in items]), AppReport.resolved_at.is_(None))
                .group_by(AppReport.data_item_id)
            ).all()
        ) if items else {}
        for item in items:
            author = db.get(User, item.author_user_id) if item.author_user_id else None
            shared.append(
                AdminDataItemRead(
                    id=item.id,
                    collection=by_id[item.collection_id].name,
                    data=item.data,
                    size_bytes=item.size_bytes,
                    author_username=author.username if author else "",
                    created_at=item.created_at,
                    open_reports=int(reports.get(item.id, 0)),
                )
            )
    usage = app_data.app_usage(db, project)
    return AdminDataRead(
        items=usage["items"],
        bytes=usage["bytes"],
        collections=[
            AdminDataCollectionRead(
                name=row.name, kind=row.kind, items=sizes.get(row.id, (0, 0))[0], bytes=sizes.get(row.id, (0, 0))[1]
            )
            for row in collections
        ],
        shared=shared,
    )


def _live_item(db: Session, item_id: int) -> AppDataItem:
    item = db.get(AppDataItem, item_id)
    if item is None or item.hidden_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="항목을 찾을 수 없습니다.")
    return item


def _reason(payload: AdminDataAction) -> str:
    reason = " ".join(payload.reason.split())
    if not reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="이유를 적어 주세요.")
    return reason


@router.post("/data/{item_id}/hide", response_model=dict, summary="Hide one shared item (audited)")
def hide_data_item(
    item_id: int,
    payload: AdminDataAction,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    closed = app_data.admin_hide(db, admin, _live_item(db, item_id), _reason(payload))
    db.commit()
    return {"detail": "항목을 숨겼습니다.", "reports_closed": closed}


@router.post("/data/{item_id}/delete", response_model=dict, summary="Delete one shared item for good (audited)")
def delete_data_item(
    item_id: int,
    payload: AdminDataAction,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    closed = app_data.admin_delete(db, admin, _live_item(db, item_id), _reason(payload))
    db.commit()
    return {"detail": "항목을 지웠습니다.", "reports_closed": closed}


# Declared last: a bare /{project_id} must not swallow /reports or /overview.
@router.get("/{project_id}", response_model=AdminAppOverview, summary="Admin › Apps: one app")
def read_overview(
    project_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> AdminAppOverview:
    project = db.get(BuilderProject, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="앱을 찾을 수 없습니다.")
    return _overview(settings, project, _figures(db, [project]))
