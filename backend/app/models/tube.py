"""CtrlAITube (promo-videos, the first real rows of Phase 8).

* `TubeVideo` — one video in the feed. `kind` says where it plays from:
  **hosted** (a file CTRL+AI serves itself — the club's promo video, one
  file for desktop and one for phones) or **youtube** (a member's video on
  their own channel, Phase 8). `official` marks the club's own video, shown
  first with a 공식 badge. Soft-deleted rows never appear (CLAUDE.md §10).
* `TubeReaction` — one member's reaction of one kind on one video
  (toggle: a row exists or not).
* `TubeComment` — a comment or one level of reply (`parent_id`), kept in
  CTRL+AI only. The author deletes their own (`deleted_at`); an admin
  hides one for everyone (`hidden_at`, with a reason, audited).
* `TubeReport` — 신고 of one comment, for the admin's queue (Admin ›
  Content), closed by handling it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class TubeVideo(TimestampMixin, Base):
    __tablename__ = "tube_videos"
    __table_args__ = (UniqueConstraint("slug", name="uq_tube_videos_slug"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    #: The address: /ctrlaitube/<slug>.
    slug: Mapped[str] = mapped_column(String(40), nullable=False)
    #: "hosted" | "youtube".
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    official: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    #: None for the club's own video.
    creator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    #: hosted: paths under the site (frontend/public), one per orientation.
    hosted_desktop_src: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    hosted_mobile_src: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    poster_desktop_src: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    poster_mobile_src: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    #: youtube: the video id (Phase 8).
    youtube_video_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    comments: Mapped[list["TubeComment"]] = relationship(back_populates="video", cascade="all, delete-orphan")


class TubeReaction(Base):
    __tablename__ = "tube_reactions"
    __table_args__ = (UniqueConstraint("video_id", "user_id", "kind", name="uq_tube_reactions_video_user_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("tube_videos.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    #: "like" | "useful" | "interesting".
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TubeComment(TimestampMixin, Base):
    __tablename__ = "tube_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("tube_videos.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    #: One level of replies: a reply's parent is a top-level comment.
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("tube_comments.id", ondelete="CASCADE"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    #: The author took it back.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: An admin hid it for everyone (audited, with the reason).
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hidden_reason: Mapped[str] = mapped_column(String(200), default="", nullable=False)

    video: Mapped[TubeVideo] = relationship(back_populates="comments")


class TubeReport(TimestampMixin, Base):
    __tablename__ = "tube_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    comment_id: Mapped[int] = mapped_column(ForeignKey("tube_comments.id", ondelete="CASCADE"), index=True, nullable=False)
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    #: What was reported, kept even after the comment is gone.
    excerpt: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
