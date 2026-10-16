"""Saved versions and 작업 steps of a Builder project (builder-snapshots).

A **version** (v1, v2, …) is a saved snapshot: every file of the project at
the moment the member saved it (버전 저장), published it (게시), or — for a
project that starts with files — the first state. Numbers only grow, so
"v3" always means the same thing. Loading one (불러오기) changes the working
copy only and makes no version.

Between snapshots a short rolling history of **steps** (each 만들기 /
고치기, each load) gives 실행 취소 / 다시 실행. Steps have no number, are
not part of the 30-version limit and are never exported. Everything here is
free; Claude's own edits are charged elsewhere, through `usage.charge()`.
"""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models import BuilderProject, BuilderProjectFile, BuilderProjectStep, BuilderProjectVersion
from app.services import app_ai_access
from app.services.storage import get_storage


class VersionError(Exception):
    """A Korean sentence for the member, and an HTTP status."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def current_files(db: Session, project: BuilderProject) -> dict[str, str]:
    """The project's files as path → content, sorted by path."""
    rows = db.scalars(
        select(BuilderProjectFile)
        .where(BuilderProjectFile.project_id == project.id)
        .order_by(BuilderProjectFile.path)
    )
    return {row.path: row.content for row in rows}


def replace_files(db: Session, project: BuilderProject, files: dict[str, str]) -> None:
    """Make the project's files exactly `files`: update, add, remove."""
    rows = {
        row.path: row
        for row in db.scalars(
            select(BuilderProjectFile).where(BuilderProjectFile.project_id == project.id)
        )
    }
    for path, row in rows.items():
        if path not in files:
            db.delete(row)
        elif row.content != files[path]:
            row.content = files[path]
    for path, content in files.items():
        if path not in rows:
            db.add(BuilderProjectFile(project_id=project.id, path=path, content=content))
    db.flush()


def snapshot(
    db: Session,
    project: BuilderProject,
    note: str,
    files: dict[str, str] | None = None,
    settings: Settings | None = None,
) -> BuilderProjectVersion:
    """A new saved version holding `files` (default: what is stored now).

    The caller decides that a version is wanted (`save`, 게시, a project
    that starts with files); a change to files never calls this.

    Numbers only grow, so "v7" always means the same thing to the member.
    Only the newest `KEEP` versions are kept; a pruned version's thumbnail
    file goes with it (`settings` names the storage — the process's own
    when a caller has none).
    """
    if files is None:
        files = current_files(db, project)
    last = db.scalar(
        select(func.max(BuilderProjectVersion.number)).where(
            BuilderProjectVersion.project_id == project.id
        )
    )
    number = (last or 0) + 1
    version = BuilderProjectVersion(
        project_id=project.id,
        number=number,
        note=note.strip()[:200],
        files=[[path, files[path]] for path in sorted(files)],
        # app-ai-access: known now, so nobody reads the files again later.
        uses_ai=app_ai_access.uses_ai(files),
    )
    db.add(version)
    # Pruned: everything older than the newest `KEEP` — except versions the
    # member pinned (버전 저장) and the one CtrlAIApps serves.
    pruned = (
        BuilderProjectVersion.project_id == project.id,
        BuilderProjectVersion.number <= number - BuilderProjectVersion.KEEP,
        BuilderProjectVersion.pinned.is_(False),
    )
    prune = delete(BuilderProjectVersion).where(*pruned)
    pictures = select(BuilderProjectVersion.number).where(*pruned, BuilderProjectVersion.thumbnail_at.is_not(None))
    if project.published_version_id is not None:
        prune = prune.where(BuilderProjectVersion.id != project.published_version_id)
        pictures = pictures.where(BuilderProjectVersion.id != project.published_version_id)
    # A pruned version's thumbnail (ui-improvements) goes with its row.
    gone = list(db.scalars(pictures))
    db.execute(prune)
    db.flush()
    if gone:
        from app.services import thumbnails  # noqa: PLC0415 — thumbnails imports this module's models; keep it one-way

        thumbnails.forget_versions(get_storage(settings or get_settings()), project.id, gone)
    return version


def ensure_baseline(db: Session, project: BuilderProject) -> None:
    """Before files change: the working copy as it is now is the current
    작업 step — so the change about to be made can be undone, also after
    files moved some other way (an example-app update, a project made
    before steps existed). Makes no version."""
    files = current_files(db, project)
    if not files:
        return
    current = current_step(db, project)
    if current is None or _files_of(current) != files:
        record_step(db, project, "처음 상태" if current is None else "이전 상태", files)


def _files_of(row: BuilderProjectVersion | BuilderProjectStep) -> dict[str, str]:
    return {str(path): str(content) for path, content in row.files}


# ------------------------------------------------------------ 작업 steps


def current_step(db: Session, project: BuilderProject) -> BuilderProjectStep | None:
    if project.step_seq is None:
        return None
    return db.scalar(
        select(BuilderProjectStep).where(
            BuilderProjectStep.project_id == project.id, BuilderProjectStep.seq == project.step_seq
        )
    )


def list_steps(db: Session, project: BuilderProject) -> list[BuilderProjectStep]:
    """Oldest first."""
    return list(
        db.scalars(
            select(BuilderProjectStep)
            .where(BuilderProjectStep.project_id == project.id)
            .order_by(BuilderProjectStep.seq)
        )
    )


def record_step(
    db: Session, project: BuilderProject, note: str, files: dict[str, str] | None = None
) -> BuilderProjectStep:
    """The working copy is now `files` (default: what is stored): a new
    step after the current one. Whatever could still be redone is gone —
    a new change starts a new line — and the history keeps `BuilderProjectStep.KEEP`
    undo steps."""
    if files is None:
        files = current_files(db, project)
    top = db.scalar(
        select(func.max(BuilderProjectStep.seq)).where(BuilderProjectStep.project_id == project.id)
    )
    if project.step_seq is not None:
        db.execute(
            delete(BuilderProjectStep).where(
                BuilderProjectStep.project_id == project.id, BuilderProjectStep.seq > project.step_seq
            )
        )
    seq = (top or 0) + 1
    step = BuilderProjectStep(
        project_id=project.id,
        seq=seq,
        note=note.strip()[:200],
        files=[[path, files[path]] for path in sorted(files)],
    )
    db.add(step)
    db.execute(
        delete(BuilderProjectStep).where(
            BuilderProjectStep.project_id == project.id,
            BuilderProjectStep.seq <= seq - BuilderProjectStep.KEEP - 1,
        )
    )
    project.step_seq = seq
    db.flush()
    return step


def go_to_step(db: Session, project: BuilderProject, seq: int) -> BuilderProjectStep:
    """실행 취소 / 다시 실행 / 이 단계로: the working copy becomes that step.
    Nothing is added or removed, so any step can be returned to."""
    step = db.scalar(
        select(BuilderProjectStep).where(
            BuilderProjectStep.project_id == project.id, BuilderProjectStep.seq == seq
        )
    )
    if step is None:
        raise VersionError("그 단계는 이미 사라졌어요.", 404)
    replace_files(db, project, _files_of(step))
    project.step_seq = step.seq
    db.flush()
    return step


# ------------------------------------------------------- saving and loading


def reference_version(db: Session, project: BuilderProject) -> BuilderProjectVersion | None:
    """The version "unsaved" is measured against: the one the member
    loaded, else the newest."""
    if project.base_version_number is not None:
        loaded = db.scalar(
            select(BuilderProjectVersion).where(
                BuilderProjectVersion.project_id == project.id,
                BuilderProjectVersion.number == project.base_version_number,
            )
        )
        if loaded is not None:
            return loaded
    return latest(db, project)


def has_unsaved(db: Session, project: BuilderProject) -> bool:
    """The working copy differs from the version it stands on (or there is
    no version yet and it holds files)."""
    files = current_files(db, project)
    reference = reference_version(db, project)
    if reference is None:
        return bool(files)
    return _files_of(reference) != files


def save(
    db: Session,
    project: BuilderProject,
    *,
    name: str = "",
    note: str = "버전 저장",
    settings: Settings | None = None,
) -> tuple[BuilderProjectVersion, bool]:
    """버전 저장: the working copy as the next numbered version (v3 after
    v2, whatever was loaded in between). `(version, created)` — when the
    files equal the version they stand on, nothing is made and that
    version comes back with `created=False` ("이미 같아요")."""
    files = current_files(db, project)
    if not files:
        raise VersionError("저장할 파일이 아직 없어요. 먼저 앱을 만들어 주세요.", 409)
    reference = reference_version(db, project)
    if reference is not None and _files_of(reference) == files:
        return reference, False
    version = snapshot(db, project, note, files, settings)
    clean = " ".join(name.split())[:80]
    if clean:
        version.label = clean
    # The new version is now what the working copy stands on.
    project.base_version_number = None
    db.flush()
    return version, True


def list_versions(db: Session, project: BuilderProject) -> list[BuilderProjectVersion]:
    return list(
        db.scalars(
            select(BuilderProjectVersion)
            .where(BuilderProjectVersion.project_id == project.id)
            .order_by(BuilderProjectVersion.number.desc())
        )
    )


def find(db: Session, project: BuilderProject, number: int) -> BuilderProjectVersion:
    version = db.scalar(
        select(BuilderProjectVersion).where(
            BuilderProjectVersion.project_id == project.id,
            BuilderProjectVersion.number == number,
        )
    )
    if version is None:
        raise VersionError("그 버전을 찾을 수 없습니다.", 404)
    return version


def latest(db: Session, project: BuilderProject) -> BuilderProjectVersion | None:
    return db.scalar(
        select(BuilderProjectVersion)
        .where(BuilderProjectVersion.project_id == project.id)
        .order_by(BuilderProjectVersion.number.desc())
        .limit(1)
    )


def label(
    db: Session, project: BuilderProject, number: int, *, name: str | None, pinned: bool | None
) -> BuilderProjectVersion:
    """버전 저장: name a version, pin it (kept past the newest 30), or both."""
    version = find(db, project, number)
    if name is not None:
        version.label = " ".join(name.split())[:80]
    if pinned is not None:
        version.pinned = pinned
    db.flush()
    return version


def restore(db: Session, project: BuilderProject, number: int) -> BuilderProjectVersion:
    """불러오기: make the working copy the files of version `number`.
    No version is made — the version stays as it was, and the state being
    left is a step, so 실행 취소 brings it back. Saving afterwards is simply
    the next number."""
    version = find(db, project, number)
    ensure_baseline(db, project)
    files = _files_of(version)
    replace_files(db, project, files)
    newest = latest(db, project)
    project.base_version_number = None if newest is not None and newest.number == number else number
    record_step(db, project, f"v{number} 불러오기", files)
    return version


