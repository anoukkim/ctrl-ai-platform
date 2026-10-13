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
