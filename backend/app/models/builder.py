"""Project Builder projects.

A BuilderProject is the member's private working object. It is not the
same thing as a published App: publishing creates a separate,
community-facing record later (Phase 5).
"""

import enum
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, status_enum


class BuilderProjectStatus(str, enum.Enum):
    """Where a project sits in its life.

    A member sees only two of these — **Draft** (draft, building, ready)
    and **게시됨** (published) — and `building` as a "생성 중…" note. The
    finer values stay in the database because later phases act on them.
    There is no archived state: deleting is soft, and a project nobody
    wants any more is deleted, not archived (decided 2026-10-07,
    migration `7c1d5e93a4b2`).
    """

    DRAFT = "draft"
    BUILDING = "building"
    READY = "ready"
    PUBLISHED = "published"


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

    # builder-static-runtime: the app's **public** folder on apps.ctrlai.my
    # — random, so an address says nothing about its owner or its id.
    # Since ctrlaiapps-publish it serves the *published* version only.
    app_slug: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    # When the working (draft) files were last written to `draft_slug`.
    app_runtime_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ctrlaiapps-publish: the working copy's own folder, for the Builder's
    # preview — never listed, so editing after 게시 changes nothing public.
    draft_slug: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    # The version CtrlAIApps and `app_slug` serve; None = not published.
    published_version_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "builder_project_versions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_builder_projects_published_version",
        ),
        nullable=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: app-platform P2: an admin stopped this app's 기능 상자 (sign-in, AI,
    #: data). The app still opens; every `/_ctrlai/v1` call is refused.
    sdk_disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sdk_disabled_reason: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    #: app-ai-access: how the app's AI is opened to other members — "demo"
    #: (the server refuses every visitor's `ctrlai.ai` call; the app shows
    #: its demo answers; nothing is charged) or "full" (signed-in visitors
    #: pay from their own 지원금). The maker chooses at 게시 and may change
    #: it later; the maker's own 미리보기 is never limited by it.
    ai_access: Mapped[str] = mapped_column(String(8), default="demo", server_default="demo", nullable=False)
    #: quality-tuning Q1: the model and 생각 깊이 this project's 만들기 /
    #: 고치기 use, remembered from the last choice. NULL: the member's
    #: default.
    chat_model_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_models.id", ondelete="SET NULL"), nullable=True
    )
    depth: Mapped[str | None] = mapped_column(String(10), nullable=True)
    #: 업데이트 메모 — one line shown on the listing (optional).
    publish_note: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    #: ui-improvements: 고정 — the owner keeps this project at the top of
    #: their Builder list. When it was pinned (NULL = not pinned).
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: ui-improvements (owner-polish 5): when the working copy's thumbnail
    #: was last captured in the maker's browser; the bytes live in storage
    #: under `thumbnails.draft_key()`. NULL = none yet.
    draft_thumbnail_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    published_version: Mapped["BuilderProjectVersion | None"] = relationship(
        foreign_keys=[published_version_id], post_update=True, lazy="joined"
    )

    @property
    def published_version_number(self) -> int | None:
        """"게시됨 v3" — the published version's number, or None."""
        return self.published_version.number if self.published_version is not None else None

    @property
    def published_thumbnail_at(self) -> datetime | None:
        """When the published version's thumbnail was captured (ui-improvements)."""
        return self.published_version.thumbnail_at if self.published_version is not None else None

    @property
    def published_uses_ai(self) -> bool:
        """Whether the published version's files call `ctrlai.ai` (app-ai-access)."""
        return bool(self.published_version.uses_ai) if self.published_version is not None else False

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


class BuilderProjectVersion(TimestampMixin, Base):
    """Every file of a project as it was after one change
    (builder-static-runtime).

    Written after each generation (예시 앱, 만들기 / 고치기), after a
    되돌리기 and when a project arrives from Chat; the member can go back
    to any of the last `KEEP` versions. Going back is itself a new version,
    so nothing is ever lost by restoring. `files` is a list of
    `[path, content]` pairs — the project is small text (≤ 2 MB).
    """

    __tablename__ = "builder_project_versions"
    __table_args__ = (
        UniqueConstraint("project_id", "number", name="uq_builder_project_versions_number"),
    )

    #: Versions kept per project; older ones are removed as new ones land.
    KEEP = 30

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    #: What made it, in Korean: "예시 앱", "고치기: 버튼 색을…", "v3으로 되돌리기".
    note: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    files: Mapped[list] = mapped_column(JSON, nullable=False)
    #: 버전 저장 (ctrlaiapps-publish): the member's own name for it, and a
    #: pin. Pinned versions — and the published one — are never pruned.
    label: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    #: app-ai-access: the files of this version call `ctrlai.ai` — found
    #: when the version is written (`app_ai_access.uses_ai`), so the 게시
    #: dialog, the listing and the shell know without reading the files.
    uses_ai: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    #: publish-summary: the 게시 dialog's pre-filled text for this version,
    #: written once (None = not asked yet). The note was written against
    #: `summary_base_version` (the published version's number then).
    summary_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_base_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary_model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    #: ui-improvements (owner-polish 4): when this version's thumbnail was
    #: captured — taken right after 게시, from the published app. NULL =
    #: none; the listing falls back to the generated cover.
    thumbnail_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<BuilderProjectVersion v{self.number} project={self.project_id}>"


class AppFavorite(TimestampMixin, Base):
    """즐겨찾기 (ui-improvements): a member keeps a published app at the
    top of their CtrlAIApps list. Per member, per project; the listing
    still filters the project's `deleted_at` and published state, so a
    favourite of an app that is gone simply does not show."""

    __tablename__ = "app_favorites"
    __table_args__ = (UniqueConstraint("user_id", "project_id", name="uq_app_favorites_user_project"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )

    def __repr__(self) -> str:
        return f"<AppFavorite user={self.user_id} project={self.project_id}>"


class AppReport(TimestampMixin, Base):
    """신고 (ctrlaiapps-publish): a member flags a published app.

    The admin sees open reports in Admin › Content and can unpublish the
    app (audited); handling a report closes it. The reporter is kept for
    the admin only — never shown to the app's owner.
    """

    __tablename__ = "app_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    reporter_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    #: app-platform P3: a report of one shared item (`ctrlai.db.report`),
    #: not of the whole app. The excerpt keeps what was reported even
    #: after the item is deleted.
    data_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_data_items.id", ondelete="SET NULL"), nullable=True
    )
    item_excerpt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:
        return f"<AppReport {self.id} project={self.project_id}>"


class BuilderGeneration(TimestampMixin, Base):
    """One 만들기 / 고치기 in stages (quality-tuning Q2).

    A small plan call first lists the files to write (shown as 만들 계획);
    then each file is written by its own call and saved the moment it is
    done, and a last call checks the whole app and fixes what it finds.
    `files_done` is what is already saved, so a run cut short by a timeout
    keeps its files and 이어서 만들기 continues with the rest. Each call is
    charged on its own (`charged_krw` adds them up); a failed call is free.

    `status`: planned → running → done, or partial (some files saved, the
    rest can be continued), failed (nothing saved), cancelled (a newer plan
    replaced it).
    """

    __tablename__ = "builder_generations"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("builder_projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: "create" (the project had no index.html) or "edit".
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    request: Mapped[str] = mapped_column(Text, nullable=False)
    style: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    #: [[path, purpose], …] in writing order.
    plan: Mapped[list] = mapped_column(JSON, nullable=False)
    files_done: Mapped[list] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    #: The self-check's one sentence, and the files it rewrote.
    check_summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    check_fixed: Mapped[list] = mapped_column(JSON, nullable=False)
    charged_krw: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    #: The last failure, in Korean, for the member.
    error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    version_id: Mapped[int | None] = mapped_column(
        ForeignKey("builder_project_versions.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:
        return f"<BuilderGeneration {self.id} {self.status} project={self.project_id}>"


class BuilderEvalReport(TimestampMixin, Base):
    """빌더 점검 (quality-tuning Q2): the owner's real-provider run of the
    staged Builder on fixed sample ideas, as a Markdown report for Admin ›
    System. Written only by `python -m app.tools.builder_eval`."""

    __tablename__ = "builder_eval_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    ideas: Mapped[int] = mapped_column(Integer, nullable=False)
    succeeded: Mapped[int] = mapped_column(Integer, nullable=False)
    total_krw: Mapped[int] = mapped_column(Integer, nullable=False)
    markdown: Mapped[str] = mapped_column(Text, nullable=False)
