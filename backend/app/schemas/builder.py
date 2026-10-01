"""Project Builder API schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.builder import BuilderProjectStatus


class BuilderProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class BuilderProjectCreate(BuilderProjectBase):
    """What the client sends to start a project.

    The owner is never taken from the request body — it comes from the
    authenticated member, so one member cannot create a project in
    another's name.
    """


class BuilderProjectUpdate(BaseModel):
    """Every field optional: this is a PATCH."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    status: BuilderProjectStatus | None = None


class BuilderProjectRead(BuilderProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: BuilderProjectStatus
    github_repo: str | None
    created_at: datetime
    updated_at: datetime
