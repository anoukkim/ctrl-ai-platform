"""When the database was last backed up (admin-consolidation v3 (4)).

The backup scripts run on the VM, outside the containers; when one
finishes it reports itself (`python -m app.db.record_backup`), and this
module reads those rows for Admin › System and the Dashboard's alert.
Nothing here touches a backup file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BackupRun

KINDS = ("local", "offsite")
#: What the scripts write: `ctrlai-YYYYMMDD-HHMMSS.sql.gz`.
FILE_NAME = re.compile(r"^ctrlai-\d{8}-\d{6}\.sql\.gz$")


def record(db: Session, kind: str, file_name: str, size_bytes: int) -> BackupRun:
    """Does not commit. Raises ValueError for an unknown kind or name."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    if not FILE_NAME.match(file_name):
        raise ValueError("file name must look like ctrlai-YYYYMMDD-HHMMSS.sql.gz")
    if size_bytes < 0:
        raise ValueError("size must not be negative")
    row = BackupRun(kind=kind, file_name=file_name, size_bytes=size_bytes)
    db.add(row)
    return row


def latest(db: Session, kind: str) -> BackupRun | None:
    return db.scalar(
        select(BackupRun).where(BackupRun.kind == kind).order_by(BackupRun.created_at.desc(), BackupRun.id.desc()).limit(1)
    )


@dataclass
class BackupLine:
    kind: str
    file_name: str | None
    size_bytes: int
    at: datetime | None
    #: Older than the alert threshold, or never recorded.
    late: bool


def status(db: Session, late_after_hours: int, now: datetime | None = None) -> list[BackupLine]:
    now = now or datetime.now(timezone.utc)
    lines = []
    for kind in KINDS:
        row = latest(db, kind)
        at = row.created_at if row is not None else None
        if at is not None and at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        lines.append(
            BackupLine(
                kind=kind,
                file_name=row.file_name if row is not None else None,
                size_bytes=row.size_bytes if row is not None else 0,
                at=at,
                late=at is None or now - at > timedelta(hours=late_after_hours),
            )
        )
    return lines
