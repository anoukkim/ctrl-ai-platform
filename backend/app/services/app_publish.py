"""CtrlAIApps: 게시, 업데이트 게시, 게시 취소, 신고 (ctrlaiapps-publish).

A published app is one *version* of a Builder project, chosen when the
member presses 게시 (or 업데이트 게시 later). CtrlAIApps lists it and
`apps.ctrlai.my/<app-slug>/` serves exactly that version; the member keeps
editing the working copy without changing what visitors see.

Every listing reads `published_listing()`, which filters on the project's
`deleted_at` — a deleted project is gone from CtrlAIApps at once (CLAUDE.md
section 10) — and on the owner not being withdrawn with "unpublish".
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    AppReport,
    AuditAction,
    BuilderProject,
    BuilderProjectStatus,
    BuilderProjectVersion,
    User,
)
from app.services import app_ai_access, app_runtime, audit, builder_versions, notifications

MAX_DESCRIPTION = 2_000
MAX_NOTE = 200
MAX_REPORT = 1_000


class PublishError(Exception):
    """A Korean sentence for the member, and an HTTP status."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def published_listing() -> Select:
    """Projects on CtrlAIApps: published, a version chosen, not deleted."""
    return select(BuilderProject).where(
        BuilderProject.status == BuilderProjectStatus.PUBLISHED,
        BuilderProject.published_version_id.is_not(None),
        BuilderProject.deleted_at.is_(None),
    )


def publish(
    db: Session,
    settings: Settings,
    project: BuilderProject,
    *,
    description: str,
    note: str,
    ai_access: str | None = None,
    notify: bool = True,
) -> BuilderProjectVersion:
    """게시 / 업데이트 게시: the newest version becomes the public one.

    `notify=False` for the example-app importer: a deploy's own publishes
    are not the admin's news (feat-notifications).

    `ai_access` (app-ai-access): "demo" or "full" — the maker's answer to
    "다른 회원에게 AI 기능을 열까요?"; None keeps what the project has
    (a new project starts as "demo").

    builder-snapshots: 게시 publishes the working copy, saving it as the
    next version first when it differs from the version it stands on — so
    what is published is always a numbered version the member can see in
    버전 기록 (and it is never pruned).
    """
    if "index.html" not in builder_versions.current_files(db, project):
        raise PublishError("index.html이 있어야 게시할 수 있어요. 먼저 앱을 만들어 주세요.", 409)
    if not description.strip():
        raise PublishError("CtrlAIApps에 보일 짧은 설명을 적어 주세요.")
    if len(description) > MAX_DESCRIPTION:
        raise PublishError("설명이 너무 깁니다(2,000자까지).")
    if len(note) > MAX_NOTE:
        raise PublishError("업데이트 메모는 200자까지 적을 수 있어요.")

    try:
        version, _created = builder_versions.save(db, project, note="게시", settings=settings)
    except builder_versions.VersionError as error:
        raise PublishError(str(error), error.status_code) from error
    files = {str(path): str(content) for path, content in version.files}
    try:
        app_runtime.write_public(db, settings, project, files)
    except app_runtime.AppRuntimeError as error:
        raise PublishError(str(error), error.status_code) from error

    try:
        chosen = app_ai_access.checked(ai_access)
    except ValueError as error:
        raise PublishError(str(error)) from error
    if chosen is not None:
        project.ai_access = chosen
    was_published = project.published_version_id is not None
    project.published_version_id = version.id
    project.published_version = version
    project.published_at = datetime.now(timezone.utc)
    project.publish_note = " ".join(note.split())
    project.description = description.strip()
    project.status = BuilderProjectStatus.PUBLISHED
    db.flush()
    # 게시 완료 / 업데이트 게시 완료 — the owner's own notification list.
    if notify:
        notifications.app_published(db, project, update=was_published)
    return version


def unpublish(db: Session, settings: Settings, project: BuilderProject) -> None:
    """게시 취소: off CtrlAIApps and off its address. Every version stays."""
    app_runtime.remove_public(settings, project)
    project.published_version_id = None
    project.published_version = None
    project.status = BuilderProjectStatus.READY
    db.flush()


def admin_unpublish(
    db: Session, settings: Settings, admin: User, project: BuilderProject, reason: str
) -> int:
    """An admin takes an app down (audited); its open reports close.
    Returns how many reports were closed."""
    was = project.published_version_number
    unpublish(db, settings, project)
    closed = _close_reports(db, project, admin)
    owner = db.get(User, project.owner_user_id)
    notifications.app_taken_down(db, project, reason, was)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.APP_UNPUBLISHED,
        target_type="builder_project",
        target_id=project.id,
        target_label=project.name,
        summary=(
            f"'{project.name}'(v{was}) 게시 내림"
            + (f" — {owner.username}" if owner else "")
            + (f" · 사유: {reason.strip()}" if reason.strip() else "")
            + (f" · 신고 {closed}건 처리" if closed else "")
        ),
        detail={"reason": reason.strip(), "version": was, "reports_closed": closed},
    )
    return closed


def _close_reports(db: Session, project: BuilderProject, admin: User) -> int:
    rows = list(
        db.scalars(
            select(AppReport).where(
                AppReport.project_id == project.id, AppReport.resolved_at.is_(None)
            )
        )
    )
    now = datetime.now(timezone.utc)
    for row in rows:
        row.resolved_at = now
        row.resolved_by = admin.id
    return len(rows)


def report(db: Session, reporter: User, project: BuilderProject, reason: str) -> AppReport:
    """신고: any signed-in member, about a listed app. One open report per
    member per app — a second press says it was already received."""
    reason = reason.strip()
    if not reason:
        raise PublishError("신고하는 이유를 적어 주세요.")
    if len(reason) > MAX_REPORT:
        raise PublishError("신고 내용은 1,000자까지 적을 수 있어요.")
    existing = db.scalar(
        select(AppReport).where(
            AppReport.project_id == project.id,
            AppReport.reporter_id == reporter.id,
            AppReport.resolved_at.is_(None),
        )
    )
    if existing is not None:
        raise PublishError("이미 신고를 받았어요. 관리자가 확인하고 있어요.", 409)
    row = AppReport(project_id=project.id, reporter_id=reporter.id, reason=reason)
    db.add(row)
    db.flush()
    return row


def resolve_report(db: Session, admin: User, row: AppReport, note: str) -> None:
    """Close a report without taking the app down (audited)."""
    row.resolved_at = datetime.now(timezone.utc)
    row.resolved_by = admin.id
    project = db.get(BuilderProject, row.project_id)
    if project is not None and project.published_version_id is not None:
        notifications.app_report_kept(db, project)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.APP_REPORT_RESOLVED,
        target_type="app_report",
        target_id=row.id,
        target_label=project.name if project else "",
        summary=f"신고 {row.id} 처리(게시 유지)" + (f" · {note.strip()}" if note.strip() else ""),
        detail={"project_id": row.project_id, "note": note.strip()},
    )


def open_report_counts(db: Session) -> dict[int, int]:
    return dict(
        db.execute(
            select(AppReport.project_id, func.count(AppReport.id))
            .where(AppReport.resolved_at.is_(None))
            .group_by(AppReport.project_id)
        ).all()
    )
