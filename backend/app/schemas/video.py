"""Video Generator API schemas: model catalog, projects, versions."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.video import VideoProjectStatus, VideoVersionStatus

# "Auto" is a Ctrl AI concept, not a provider model id. Sending it means
# "let Ctrl AI pick", which for now resolves to the configured default.
AUTO_MODEL_VALUE = "auto"


class VideoModelRead(BaseModel):
    """A model as members see it.

    `enabled` and `member_visible` are not exposed here: members only ever
    receive rows where both are already true, so showing the switches
    would leak how the catalog is administered.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    model_id: str
    display_name: str
    description: str
    sort_order: int
    capabilities: dict


class VideoModelAdminRead(VideoModelRead):
    """The same row with the admin switches attached."""

    enabled: bool
    member_visible: bool
    created_at: datetime
    updated_at: datetime


class VideoModelAdminUpdate(BaseModel):
    """Toggles an admin may change. The model id itself is not editable
    here: correcting it would silently repoint existing versions."""

    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None
    member_visible: bool | None = None
    sort_order: int | None = None


class VideoVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    provider: str
    model_id: str
    provider_job_id: str | None
    asset_url: str | None
    prompt_snapshot: str
    status: VideoVersionStatus
    created_at: datetime


class VideoProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(default="", max_length=4000)


class VideoProjectCreate(VideoProjectBase):
    """`selected_model_id` may be omitted, which means Auto."""

    selected_model_id: int | None = None


class VideoProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    prompt: str | None = Field(default=None, max_length=4000)
    selected_model_id: int | None = None
    status: VideoProjectStatus | None = None
    final_version_id: int | None = None


class VideoProjectRead(VideoProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    selected_model_id: int | None
    status: VideoProjectStatus
    final_version_id: int | None
    created_at: datetime
    updated_at: datetime


class VideoProjectDetail(VideoProjectRead):
    """A single project with everything the workspace needs."""

    versions: list[VideoVersionRead] = []
    selected_model: VideoModelRead | None = None
