"""CtrlAIApps reactions and comments (ctrlaiapps-reactions, Phase 5's
remaining slice) — the same shape as CtrlAITube's (promo-videos): three
reactions, one level of replies, 신고 to Admin › Content, admin hide /
delete with a reason (audited). Rows hang off the Builder project; every
read goes through the published listing, so a deleted or unpublished app
shows none of them.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class AppReaction(Base):
    __tablename__ = "app_reactions"
    __table_args__ = (UniqueConstraint("project_id", "user_id", "kind", name="uq_app_reactions_project_user_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    #: "like" | "useful" | "interesting".
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AppComment(TimestampMixin, Base):
    __tablename__ = "app_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    #: One level of replies: a reply's parent is a top-level comment.
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("app_comments.id", ondelete="CASCADE"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hidden_reason: Mapped[str] = mapped_column(String(200), default="", nullable=False)


class AppCommentReport(TimestampMixin, Base):
    __tablename__ = "app_comment_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: None once an admin deleted the comment; the excerpt remains.
    comment_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_comments.id", ondelete="SET NULL"), index=True, nullable=True
    )
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    excerpt: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
