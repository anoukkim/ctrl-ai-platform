"""Removing deleted work for good (ui-improvements B, owner 2026-10-16).

A member's 삭제 is soft: the row stays so Admin › Deleted Items can bring
it back. Two things end that grace period:

* an admin presses **완전히 삭제** on one item, with a reason;
* **분기 마감** removes everything still in Deleted Items — the owner's
  decision: what nobody restored by the end of the quarter is gone.

What goes: the project or video row with its files, versions,
generations, app consents, sessions, data and reports (deleted here,
youngest first — PostgreSQL would cascade, SQLite in the tests would
not); the app's folders on `apps.ctrlai.my`; a video's stored files. **What stays: every money row.** `usage_events`
points at the work with `ON DELETE SET NULL`, wallets and adjustments
never pointed at it, and the audit log is append-only. The one thing a
money row would lose is the *name* Usage shows, so it is copied onto
each of the work's usage events first (`UsageEvent.work_label`).

Rows are deleted with Core `delete()` statements, not `session.delete()`:
the ORM would otherwise try to null the children's foreign keys before
the database gets to cascade, and those columns are NOT NULL. Files and
folders are removed **after** the transaction commits (`remove_files`),
so a failed commit leaves nothing half-done on disk.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    AppConsent,
    AppDataCollection,
    AppDataItem,
    AppDataWrite,
    AppFavorite,
    AppLoginCode,
    AppReport,
    AppSession,
    AuditAction,
    BuilderGeneration,
    BuilderProject,
    BuilderProjectFile,
    BuilderProjectVersion,
    Quarter,
    UsageEvent,
    User,
    VideoProject,
    VideoVersion,
)
from app.services import app_runtime, audit
from app.services.chat_limits import KST
from app.services.storage import AssetStorage, StorageKeyError

#: What each kind is called in Korean, for audit summaries.
KIND_LABEL = {"builder": "프로젝트", "video": "영상 프로젝트"}


@dataclass
class Purged:
    """What one purge removed — for the audit row and the clean-up on disk."""

    kind: str
    id: int
    name: str
    owner_user_id: int
    owner_username: str
    deleted_at: str
    versions: int = 0
    files: int = 0
    usage_events: int = 0
    #: App folders to drop after commit (builder).
    slugs: list[str] = field(default_factory=list)
    #: Stored files to drop after commit (video).
    storage_keys: list[str] = field(default_factory=list)

    def as_detail(self) -> dict:
        return {
            "kind": self.kind,
            "id": self.id,
            "name": self.name,
            "owner_user_id": self.owner_user_id,
            "owner_username": self.owner_username,
            "deleted_at": self.deleted_at,
            "versions": self.versions,
            "files": self.files,
            "usage_events": self.usage_events,
        }


def close_cutoff(quarter: Quarter) -> datetime:
    """분기 마감 purges what was deleted up to the quarter's last day (KST).

    A quarter closed late — 1월에 닫는 4분기 — must not take with it the
    work a member deleted this week, expecting the grace the Deleted Items
    footnote promises; that work waits for the quarter it was deleted in.
    """
    return datetime.combine(quarter.ends_at + timedelta(days=1), time.min, tzinfo=KST)


def _deleted(model, until: datetime | None):
    condition = model.deleted_at.is_not(None)
    if until is not None:
        condition = condition & (model.deleted_at < until)
    return condition


def deleted_items(db: Session, *, until: datetime | None = None) -> list[BuilderProject | VideoProject]:
    """Everything in Deleted Items, both products — deleted before `until` when given."""
    rows: list[BuilderProject | VideoProject] = list(
        db.scalars(select(BuilderProject).where(_deleted(BuilderProject, until)))
    )
    rows.extend(db.scalars(select(VideoProject).where(_deleted(VideoProject, until))))
    return rows


def deleted_count(db: Session, *, until: datetime | None = None) -> int:
    builder = db.scalar(select(func.count()).select_from(BuilderProject).where(_deleted(BuilderProject, until))) or 0
    video = db.scalar(select(func.count()).select_from(VideoProject).where(_deleted(VideoProject, until))) or 0
    return int(builder) + int(video)


def _owner_name(db: Session, user_id: int) -> str:
    owner = db.get(User, user_id)
    return owner.username if owner else ""


def purge(db: Session, item: BuilderProject | VideoProject) -> Purged:
    """Remove one deleted project or video from the database. Does not
    commit, and touches nothing on disk — see `remove_files`.

    Refuses live work: the only way in is through Deleted Items, so a
    purge is always the second step after a delete.

    Children are deleted explicitly, youngest first, even though the
    database's foreign keys cascade on PostgreSQL: the tests run on SQLite,
    which does not enforce them, and a purge that quietly leaves orphans
    there would be a purge nobody trusts. The usage events are detached
    explicitly for the same reason.
    """
    # Lock the row and look again: an admin who restores it between the
    # list and this call wins — a restore that a purge then overrides
    # would leave an audit row about work that no longer exists.
    model = BuilderProject if isinstance(item, BuilderProject) else VideoProject
    fresh = db.execute(
        select(model).where(model.id == item.id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if fresh is None or fresh.deleted_at is None:
        raise ValueError("삭제된 항목만 완전히 삭제할 수 있습니다.")
    item = fresh

    if isinstance(item, BuilderProject):
        pid = item.id
        facts = Purged(
            kind="builder",
            id=pid,
            name=item.name,
            owner_user_id=item.owner_user_id,
            owner_username=_owner_name(db, item.owner_user_id),
            deleted_at=item.deleted_at.isoformat(),
            versions=_count(db, BuilderProjectVersion, BuilderProjectVersion.project_id == pid),
            files=_count(db, BuilderProjectFile, BuilderProjectFile.project_id == pid),
            slugs=[slug for slug in (item.app_slug, item.draft_slug) if slug],
        )
        facts.usage_events = db.execute(
            update(UsageEvent)
            .where(UsageEvent.builder_project_id == pid)
            .values(work_label=item.name[:120], builder_project_id=None)
        ).rowcount
        # The project points at its published version; cut that first.
        db.execute(update(BuilderProject).where(BuilderProject.id == pid).values(published_version_id=None))
        for child in (
            AppReport,
            AppDataItem,
            AppDataCollection,
            AppDataWrite,
            AppLoginCode,
            AppSession,
            AppConsent,
            AppFavorite,
            BuilderGeneration,
            BuilderProjectFile,
            BuilderProjectVersion,
        ):
            db.execute(delete(child).where(child.project_id == pid))
        db.execute(delete(BuilderProject).where(BuilderProject.id == pid))
    else:
        vid = item.id
        versions = list(db.scalars(select(VideoVersion).where(VideoVersion.project_id == vid)))
        facts = Purged(
            kind="video",
            id=vid,
            name=item.name,
            owner_user_id=item.owner_user_id,
            owner_username=_owner_name(db, item.owner_user_id),
            deleted_at=item.deleted_at.isoformat(),
            versions=len(versions),
            files=sum(1 for v in versions if v.asset_storage_key),
            storage_keys=[v.asset_storage_key for v in versions if v.asset_storage_key],
        )
        facts.usage_events = db.execute(
            update(UsageEvent)
            .where(UsageEvent.video_project_id == vid)
            .values(work_label=item.name[:120], video_project_id=None, video_version_id=None)
        ).rowcount
        for version in versions:
            db.expunge(version)
        db.execute(delete(VideoVersion).where(VideoVersion.project_id == vid))
        db.execute(delete(VideoProject).where(VideoProject.id == vid))

    db.expunge(item)
    return facts


def _count(db: Session, model, condition) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(condition)) or 0)


def purge_all_deleted(db: Session, *, admin: User, quarter: Quarter) -> list[Purged]:
    """분기 마감: purge everything in Deleted Items that was deleted by the
    quarter's last day (`close_cutoff`) and write one audit row. Does not
    commit. An item restored meanwhile is skipped, not recorded."""
    purged: list[Purged] = []
    for item in deleted_items(db, until=close_cutoff(quarter)):
        try:
            purged.append(purge(db, item))
        except ValueError:
            continue
    if not purged:
        return purged
    audit.record(
        db,
        actor=admin,
        action=AuditAction.WORK_PURGED_AT_CLOSE,
        target_type="quarter",
        target_id=quarter.id,
        target_label=quarter.code,
        summary=(
            f"{quarter.display_name} 분기 마감으로 되살리지 않은 작업물 {len(purged)}개를 "
            "완전히 삭제했습니다. 사용량 기록과 지갑은 그대로입니다."
        ),
        detail={"count": len(purged), "items": [facts.as_detail() for facts in purged]},
    )
    return purged


def remove_files(settings: Settings, storage: AssetStorage, purged: list[Purged]) -> None:
    """Drop the folders and stored files of purged work. Call after commit.

    A file that is already gone is not an error; a file that cannot be
    removed, or whose stored key no longer passes the storage's key
    check, is left for the operator — the database is the source of
    truth, and the row is already gone.
    """
    for facts in purged:
        if facts.slugs:
            app_runtime.remove_slugs(settings, *facts.slugs)
        for key in facts.storage_keys:
            try:
                storage.delete(key)
            except (OSError, StorageKeyError):
                continue
