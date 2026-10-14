"""Project Builder API schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.builder import BuilderProjectStatus


class BuilderProjectBase(BaseModel):
    # No length rule here on purpose. `app/services/work.clean_name` is the
    # single authority on what a name may be, because it is the only place
    # that can answer in Korean — a pydantic failure arrives as a list under
    # `detail`, and the frontend only renders a string.
    name: str
    description: str = Field(default="", max_length=2000)


class BuilderProjectCreate(BuilderProjectBase):
    """What the client sends to start a project.

    The owner is never taken from the request body — it comes from the
    authenticated member, so one member cannot create a project in
    another's name.
    """


class BuilderProjectFromChat(BuilderProjectBase):
    """Builder로 보내기 (chat-plus-artifacts): a chat reply's HTML block
    becomes a new project's `index.html`. No Claude call, no charge."""

    html: str = Field(min_length=1)


class BuilderProjectUpdate(BaseModel):
    """Every field optional: this is a PATCH."""

    name: str | None = None
    description: str | None = Field(default=None, max_length=2000)
    status: BuilderProjectStatus | None = None


class BuilderProjectRead(BuilderProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: BuilderProjectStatus
    github_repo: str | None
    #: builder-static-runtime: the app's folder on the apps origin, and when
    #: its files were last written there. The address is
    #: `<apps_base_url>/<app_slug>/` (`/api/site` gives the base); while
    #: `app_runtime_at` is empty, nothing is served yet.
    app_slug: str | None = None
    app_runtime_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class BuilderFileRead(BaseModel):
    """One file of a project, as the workspace shows it (read-only for now)."""

    model_config = ConfigDict(from_attributes=True)

    path: str
    content: str
    updated_at: datetime


class StarterRequest(BaseModel):
    """What the member wants. Empty means the project's description."""

    idea: str = Field(default="", max_length=2000)


class StarterRead(BaseModel):
    files: list[BuilderFileRead]
    #: Two Korean sentences from Claude: what it made, and what to ask next.
    summary: str
    charged_krw: int


class StarterEstimateRead(BaseModel):
    """Shown next to 예시 앱 만들기 before anything is spent."""

    estimated_krw: int
    #: What the wallet must hold: the whole output budget, priced.
    worst_case_krw: int
    model_label: str


# ------------------------------------------------ builder-static-runtime


class GenerateRequest(BaseModel):
    """만들기 / 고치기: what the member wants, in their words."""

    request: str = Field(min_length=1, max_length=2000)


class EditEstimateRead(BaseModel):
    """Shown next to 만들기 before anything is spent."""

    estimated_krw: int
    #: What the wallet must hold: the whole output budget, priced.
    worst_case_krw: int
    model_label: str
    max_output_tokens: int


class VersionRead(BaseModel):
    number: int
    note: str
    created_at: datetime
    file_count: int
    total_bytes: int


class GenerateRead(BaseModel):
    files: list[BuilderFileRead]
    #: Paths Claude created or changed, in the order it wrote them.
    changed: list[str]
    summary: str
    charged_krw: int
    version: VersionRead
    project: BuilderProjectRead


class RestoreRead(BaseModel):
    files: list[BuilderFileRead]
    version: VersionRead
    project: BuilderProjectRead
