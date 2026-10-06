"""Project Builder projects.

A BuilderProject is the member's private working object. It is not the
same thing as a published App: publishing creates a separate,
community-facing record later (Phase 5).
"""

import enum

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, status_enum


class BuilderProjectStatus(str, enum.Enum):
    """Where a project sits in its life."""

    DRAFT = "draft"
    BUILDING = "building"
    READY = "ready"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class BuilderProject(SoftDeleteMixin, TimestampMixin, Base):
    """One app project owned by one member.

    `owner_user_id` is required and every query is scoped by it: a member
    only ever sees their own projects. There is no shared Builder project
    in Phase 1.

    Deleting is soft — see `SoftDeleteMixin`. When Phase 5 publishes a
    project to CtrlAIApps, that listing must be filtered on this row's
    `deleted_at` too: a deleted project is gone from the community
    surface, not only from the owner's library.
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

    files: Mapped[list["BuilderProjectFile"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="BuilderProjectFile.path",
    )

    def __repr__(self) -> str:
        return f"<BuilderProject {self.id} {self.name!r} owner={self.owner_user_id}>"


class BuilderProjectFile(TimestampMixin, Base):
    """One text file belonging to a project.

    **Nothing writes these yet.** Phase 3 is what fills them: Claude
    generates project files and the editor saves them. The table exists
    now because "코드 다운로드 (ZIP)" has to read the files from
    somewhere, and a download route built against a store that does not
    exist cannot be tested at all.

    So a project made today downloads as a ZIP holding only the guide
    file. That is honest — the project really has no files — and Phase 3
    changes nothing about the download: it only starts writing rows here.

    Text only, and the content lives in the column rather than on disk.
    Builder projects are small source trees, which is what a database
    column is good at; binary assets would be a different decision and
    there are none. `path` is the path *inside* the project, with forward
    slashes and no leading slash — "app/page.tsx". The ZIP builder checks
    that again before writing, because a path that escapes the project is
    the one mistake here that could reach outside it.
    """

    __tablename__ = "builder_project_files"
    __table_args__ = (
        # One row per path per project. Without this, two writes of the
        # same file leave two rows and the ZIP gets the file twice.
        UniqueConstraint("project_id", "path", name="uq_builder_project_files_path"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )

    path: Mapped[str] = mapped_column(String(400), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)

    project: Mapped["BuilderProject"] = relationship(back_populates="files")

    def __repr__(self) -> str:
        return f"<BuilderProjectFile {self.path!r} project={self.project_id}>"
