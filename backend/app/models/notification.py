"""A member's notifications (feat-notifications, owner-polish 2).

One row per thing that happened to *this* member — 게시 완료, 참여 신청
승인, 지원금 사용 요약, an app taken down — written by the code that made it
happen (`services/notifications.py`), never by the browser. The browser
only reads them and marks them read. Rows older than `KEEP_DAYS` are
dropped the next time the member looks; `dedupe_key` keeps a summary from
being written twice (one row per member per day for spending).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_notification_dedupe"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    #: "publish" | "application" | "spend" | "milestone" | "app_report" — the
    #: screen picks an icon by it; nothing else depends on the value.
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    #: Where the row leads inside the site ("/usage", "/ctrlaistore/<slug>"); None = nowhere.
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    #: Set for rows that must exist once ("spend:2026-10-16"); None otherwise.
    dedupe_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
