"""Video Generator: the model catalog, projects, and generated versions."""

import enum

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, status_enum


class VideoProjectStatus(str, enum.Enum):
    DRAFT = "draft"
    GENERATING = "generating"
    READY = "ready"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class VideoVersionStatus(str, enum.Enum):
    QUEUED = "queued"
    GENERATING = "generating"
    READY = "ready"
    FAILED = "failed"


class VideoModel(TimestampMixin, Base):
    """One video model a provider offers.

    Higgsfield is the *provider*, not a model: it fronts several models
    (Kling, Seedance, Wan, ...) and that catalog changes over time. So the
    list lives in the database and an admin decides what members may use;
    it is never hard-coded in the frontend.

    Members are only ever offered rows where `enabled` AND `member_visible`
    are both true.
    """

    __tablename__ = "video_models"

    id: Mapped[int] = mapped_column(primary_key=True)

    # "higgsfield" today. Kept separate from model_id so a second provider
    # can be added without reshaping anything.
    provider: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    # The identifier the provider's API expects.
    model_id: Mapped[str] = mapped_column(String(120), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Two independent switches, on purpose:
    #   enabled        — Ctrl AI may call this model at all
    #   member_visible — members may pick it themselves
    # An admin can keep a model enabled for internal use while hiding it.
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    member_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # What this particular model supports — durations, aspect ratios,
    # sound, generation type. Free-form on purpose: models differ, and the
    # settings a member sees should eventually be driven by this rather
    # than by one fixed global list. Shape is not enforced yet.
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    def __repr__(self) -> str:
        return f"<VideoModel {self.provider}/{self.model_id} enabled={self.enabled}>"


class VideoProject(SoftDeleteMixin, TimestampMixin, Base):
    """One video idea a member works on, across many attempts.

    A Video Project is NOT a single generated video. It holds the prompt,
    the settings, every generated version, and eventually the one version
    the member chose as final.

    Deleting is soft — see `SoftDeleteMixin`. The versions are left
    untouched: restoring a project has to bring back the attempts that
    belong to it, and `cascade="all, delete-orphan"` only ever runs when a
    project is removed for real, which nothing does.

    When Phase 8 publishes a video to CtrlAITube, that feed must be
    filtered on `deleted_at` as well.
    """

    __tablename__ = "video_projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Written in Korean by the member. Any translation a provider needs
    # happens on the backend later; the member's own words are what is kept.
    prompt: Mapped[str] = mapped_column(Text, default="", nullable=False)

    selected_model_id: Mapped[int | None] = mapped_column(
        ForeignKey("video_models.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[VideoProjectStatus] = mapped_column(
        status_enum(VideoProjectStatus, "videoprojectstatus"),
        default=VideoProjectStatus.DRAFT,
        nullable=False,
    )

    # Deliberately a plain integer rather than a foreign key: video_versions
    # already points back at video_projects, and a second FK the other way
    # makes a circular dependency that neither Alembic nor SQLite handles
    # cleanly. The application keeps it consistent.
    final_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    versions: Mapped[list["VideoVersion"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="VideoVersion.id",
    )
    selected_model: Mapped["VideoModel | None"] = relationship(lazy="joined")

    def __repr__(self) -> str:
        return f"<VideoProject {self.id} {self.name!r} owner={self.owner_user_id}>"


class VideoVersion(TimestampMixin, Base):
    """One generation attempt within a project.

    The prompt is copied in at generation time (`prompt_snapshot`) so a
    version always shows what actually produced it, even after the member
    edits the project's prompt.
    """

    __tablename__ = "video_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("video_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )

    # Recorded per version, not read from the project: the member may
    # switch models between attempts.
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model_id: Mapped[str] = mapped_column(String(120), nullable=False)

    # Filled once a real provider is called (Phase 6).
    provider_job_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    asset_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    prompt_snapshot: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[VideoVersionStatus] = mapped_column(
        status_enum(VideoVersionStatus, "videoversionstatus"),
        default=VideoVersionStatus.READY,
        nullable=False,
    )

    # The settings this attempt was made with, copied in for the same
    # reason as `prompt_snapshot`: the member keeps changing the controls,
    # and a version has to keep showing what actually produced it. Without
    # these the workspace could only guess, and it guessed wrong — a
    # version made at 10 seconds was played back as 15.
    #
    # Nullable because versions created before this column existed have no
    # honest value. The workspace reads a missing figure as "unknown" and
    # says so rather than inventing one.
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    aspect_ratio: Mapped[str | None] = mapped_column(String(10), nullable=True)
    sound: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Whether the member had "Auto" selected when this was generated.
    # `model_id` above records which model Auto resolved to; this records
    # that it was Auto's choice and not the member's, which is what the
    # screen shows as "Auto → Kling 3.0 Pro".
    auto_selected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    project: Mapped["VideoProject"] = relationship(back_populates="versions")

    @property
    def label(self) -> str:
        """v1, v2, ... — position within the project, not the row id."""
        if not self.project:
            return f"v{self.id}"
        for index, version in enumerate(self.project.versions, start=1):
            if version.id == self.id:
                return f"v{index}"
        return f"v{self.id}"

    def __repr__(self) -> str:
        return f"<VideoVersion {self.id} project={self.project_id} {self.status.value}>"
