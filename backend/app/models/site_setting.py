"""Settings the 관리자 changes from Admin › System, and the backups the
server reports (admin-consolidation v3 (4)).

`SiteSetting` is history like `FeatureSwitch` and `ChatLimits`: a new row
per change, the newest row per key is the one in force, and no row means
the code's default (`services/site_settings.py`). Two keys today —
`banner` (the top strip: text, shown, its 의견 보내기 link) and `alerts`
(the Dashboard's thresholds). Every change is also an audit entry.

`BackupRun` is one finished backup, written by `deploy/backup.sh` and
`deploy/offsite-backup.sh` through `python -m app.db.record_backup`, so
System can say when the last one ran and the Dashboard can warn when it
is late. The backend never reads the backup files themselves.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class SiteSetting(Base):
    __tablename__ = "site_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: `site_settings.BANNER` or `site_settings.ALERTS`.
    key: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    value: Mapped[dict] = mapped_column(JSON_TYPE, nullable=False)
    set_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<SiteSetting {self.key}>"


class BackupRun(Base):
    __tablename__ = "backup_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: "local" (`~/backups` on the VM) or "offsite" (the Cloud Storage bucket).
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    #: The file's name only (`ctrlai-20261017-031500.sql.gz`), never a path.
    file_name: Mapped[str] = mapped_column(String(200), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<BackupRun {self.kind} {self.file_name}>"
