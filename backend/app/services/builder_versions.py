"""Restorable versions of a Builder project (builder-static-runtime).

A version is every file of the project after one change. They are written
by the code that changes files — a generation, a restore, a project that
arrives from Chat — never by a route of their own, so there is no way to
change files without leaving a version behind.
"""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import BuilderProject, BuilderProjectFile, BuilderProjectVersion


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
    db: Session, project: BuilderProject, note: str, files: dict[str, str] | None = None
) -> BuilderProjectVersion:
    """A new version holding `files` (default: what is stored now).

    Numbers only grow, so "v7" always means the same thing to the member.
    Only the newest `KEEP` versions are kept.
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
    )
    db.add(version)
    db.execute(
        delete(BuilderProjectVersion).where(
            BuilderProjectVersion.project_id == project.id,
            BuilderProjectVersion.number <= number - BuilderProjectVersion.KEEP,
        )
    )
    db.flush()
    return version


def ensure_baseline(db: Session, project: BuilderProject) -> None:
    """A project with files but no version yet (made before versions
    existed) gets one of how it is now, so the first change can be undone."""
    has_version = db.scalar(
        select(BuilderProjectVersion.id).where(BuilderProjectVersion.project_id == project.id).limit(1)
    )
    if has_version is None and current_files(db, project):
        snapshot(db, project, "처음 상태")


def list_versions(db: Session, project: BuilderProject) -> list[BuilderProjectVersion]:
    return list(
        db.scalars(
            select(BuilderProjectVersion)
            .where(BuilderProjectVersion.project_id == project.id)
            .order_by(BuilderProjectVersion.number.desc())
        )
    )


def restore(db: Session, project: BuilderProject, number: int) -> BuilderProjectVersion:
    """Go back to version `number` — as a new version, so nothing is lost."""
    version = db.scalar(
        select(BuilderProjectVersion).where(
            BuilderProjectVersion.project_id == project.id,
            BuilderProjectVersion.number == number,
        )
    )
    if version is None:
        raise VersionError("그 버전을 찾을 수 없습니다.", 404)
    files = {str(path): str(content) for path, content in version.files}
    replace_files(db, project, files)
    return snapshot(db, project, f"v{number}{_ro(number)} 되돌리기", files)


def _ro(number: int) -> str:
    """The particle after a number read in Korean: 삼으로, 이로, 칠로."""
    return "으로" if number % 10 in (0, 3, 6) else "로"
