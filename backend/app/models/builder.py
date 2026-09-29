"""Project Builder projects.

A BuilderProject is the member's private working object. It is not the
same thing as a published App: publishing creates a separate,
community-facing record later (Phase 5).
"""

import enum

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.models.season import status_enum


class BuilderProjectStatus(str, enum.Enum):
    """Where a project sits in its life."""

    DRAFT = "draft"
    BUILDING = "building"
    READY = "ready"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class BuilderProject(TimestampMixin, Base):
    """One app project owned by one member.

    `owner_user_id` is required and every query is scoped by it: a member
    only ever sees their own projects. There is no shared Builder project
    in Phase 1.
    """

    __tablename__ = "builder_projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[BuilderProjectStatus] = mapped_column(
        status_enum(BuilderProjectStatus, "builderprojectstatus"),
        default=BuilderProjectStatus.DRAFT,
        nullable=False,
    )

    # Set once the member connects GitHub and pushes (Phase 4). Until then
    # the UI shows "GitHub 미연결".
    github_repo: Mapped[str | None] = mapped_column(String(200), nullable=True)

    def __repr__(self) -> str:
        return f"<BuilderProject {self.id} {self.name!r} owner={self.owner_user_id}>"
