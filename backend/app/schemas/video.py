"""Video Generator API schemas: model catalog, projects, versions."""

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.models.video import VideoProjectStatus, VideoVersionKind, VideoVersionStatus

# "Auto" is a Ctrl AI concept, not a provider model id. Sending it means
# "let Ctrl AI pick", which for now resolves to the configured default.
AUTO_MODEL_VALUE = "auto"


# ------------------------------------------------------------ the catalogue

#: The ratios the product can draw. A new one needs a frame shape in the
#: workspace (`frontend/lib/aspect.ts`) before a model may offer it.
ASPECT_RATIOS = ("9:16", "16:9", "1:1")
_RESOLUTION = re.compile(r"^[1-9][0-9]{2,3}p$")
MAX_SECONDS = 60
MAX_PRICE_PER_SECOND_KRW = 100_000


class CatalogError(ValueError):
    """A catalogue entry that cannot be accepted. The message is Korean."""


class VideoDefaults(BaseModel):
    """What the workspace pre-selects for this model."""

    model_config = ConfigDict(extra="forbid")

    duration_seconds: int
    aspect_ratio: str
    resolution: str
    sound: bool


class VideoCapabilities(BaseModel):
    """Everything video creation follows for one model.

    The workspace shows exactly these options and nothing else, and the
    backend refuses any request outside them. Prices are whole won per
    second, one per resolution: the estimate a member sees is
    `seconds x price_per_second_krw[resolution]`, and so is the charge.

    `prices_are_examples` marks figures seeded as placeholders. It is
    cleared the first time an admin saves the model, so the Video Models
    screen can say which prices nobody has confirmed yet.
    """

    model_config = ConfigDict(extra="forbid")

    durations: list[int]
    aspect_ratios: list[str]
    resolutions: list[str]
    sound: bool
    supports_edit: bool
    supports_extend: bool
    price_per_second_krw: dict[str, int]
    defaults: VideoDefaults
    prices_are_examples: bool = False

    @model_validator(mode="after")
    def _check(self) -> "VideoCapabilities":
        # Every message is a sentence an admin can act on, in Korean,
        # because it is shown as-is on the Video Models screen.
        if not self.durations:
            raise CatalogError("길이를 하나 이상 정해 주세요.")
        if any(not 1 <= value <= MAX_SECONDS for value in self.durations):
            raise CatalogError(f"길이는 1초에서 {MAX_SECONDS}초 사이여야 합니다.")
        self.durations = sorted(set(self.durations))

        if not self.aspect_ratios:
            raise CatalogError("비율을 하나 이상 정해 주세요.")
        unknown = [r for r in self.aspect_ratios if r not in ASPECT_RATIOS]
        if unknown:
            raise CatalogError(f"지원하지 않는 비율입니다: {', '.join(unknown)}")
        self.aspect_ratios = [r for r in ASPECT_RATIOS if r in self.aspect_ratios]

        if not self.resolutions:
            raise CatalogError("화질을 하나 이상 정해 주세요.")
        bad = [r for r in self.resolutions if not _RESOLUTION.match(r)]
        if bad:
            raise CatalogError(f"화질은 720p처럼 적어 주세요: {', '.join(bad)}")
        if len(set(self.resolutions)) != len(self.resolutions):
            raise CatalogError("같은 화질이 두 번 들어 있습니다.")

        missing = [r for r in self.resolutions if r not in self.price_per_second_krw]
        if missing:
            raise CatalogError(f"화질마다 초당 가격이 있어야 합니다: {', '.join(missing)}")
        extra = [r for r in self.price_per_second_krw if r not in self.resolutions]
        if extra:
            raise CatalogError(f"없는 화질의 가격이 들어 있습니다: {', '.join(extra)}")
        if any(
            not 1 <= price <= MAX_PRICE_PER_SECOND_KRW
            for price in self.price_per_second_krw.values()
        ):
            raise CatalogError(
                f"초당 가격은 1원에서 {MAX_PRICE_PER_SECOND_KRW:,}원 사이여야 합니다."
            )

        d = self.defaults
        if d.duration_seconds not in self.durations:
            raise CatalogError("기본 길이는 고를 수 있는 길이 중 하나여야 합니다.")
        if d.aspect_ratio not in self.aspect_ratios:
            raise CatalogError("기본 비율은 고를 수 있는 비율 중 하나여야 합니다.")
        if d.resolution not in self.resolutions:
            raise CatalogError("기본 화질은 고를 수 있는 화질 중 하나여야 합니다.")
        if d.sound and not self.sound:
            raise CatalogError("소리를 지원하지 않는 모델은 기본값도 소리 끔이어야 합니다.")
        return self


def parse_capabilities(raw: object) -> VideoCapabilities:
    """Validate a catalogue entry, turning any failure into one Korean sentence.

    Pydantic's own messages are English and arrive as a list; the admin
    screen shows a single string. A type error (text where a number
    belongs) has no sentence of ours, so it gets a general one naming the
    field.
    """
    try:
        return VideoCapabilities.model_validate(raw)
    except ValidationError as error:
        first = error.errors()[0]
        cause = (first.get("ctx") or {}).get("error")
        if isinstance(cause, CatalogError):
            raise CatalogError(str(cause)) from None
        where = ".".join(str(part) for part in first.get("loc", ())) or "설정"
        raise CatalogError(f"모델 설정의 형식이 올바르지 않습니다 ({where}).") from None


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
    capabilities: VideoCapabilities


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
    #: The whole catalogue entry, replaced at once. Raw here and checked by
    #: `parse_capabilities` in the route, so a mistake comes back as one
    #: Korean sentence rather than FastAPI's list of English errors.
    capabilities: dict | None = None


class VideoVersionCreate(BaseModel):
    """The settings a generation attempt is made with.

    Every field is optional so an older client — or a probe — can still
    post an empty body. What arrives is checked against the chosen model's
    capabilities before it is stored: the browser decides what to ask for,
    the backend decides what is allowed.
    """

    duration_seconds: int | None = Field(default=None, ge=1, le=600)
    aspect_ratio: str | None = Field(default=None, max_length=10)
    resolution: str | None = Field(default=None, max_length=10)
    sound: bool | None = None


class VideoEditCreate(BaseModel):
    """이 영상 수정하기 — what to change. Length, ratio and resolution come
    from the source version and cannot be sent."""

    instruction: str = Field(min_length=1, max_length=1000)


class VideoExtendCreate(BaseModel):
    """이어서 만들기 — how many seconds to add, from the model's lengths."""

    duration_seconds: int = Field(ge=1, le=600)


class PromptHelpRequest(BaseModel):
    """프롬프트 도움받기 — the member's request about their current prompt."""

    prompt: str = Field(default="", max_length=4000)
    request: str = Field(min_length=1, max_length=1000)


class PromptHelpRead(BaseModel):
    """Claude's reply, and the rewritten prompt when it made one.

    Nothing here generates video. `charged_krw` is what came off the Build
    budget, so the panel can say so.
    """

    reply: str
    revised_prompt: str | None
    charged_krw: int


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

    #: Whether this version has a file to download. The storage key
    #: itself is never sent — the screen only needs the yes or no.
    has_asset: bool = False

    # What this attempt was made with. `None` means the version predates
    # the columns and its settings are genuinely unknown — the workspace
    # must not fill the gap with the member's current selection.
    duration_seconds: int | None = None
    aspect_ratio: str | None = None
    sound: bool | None = None
    resolution: str | None = None
    auto_selected: bool | None = None

    #: 생성 / 수정 / 이어서, and the version it was made from.
    kind: VideoVersionKind = VideoVersionKind.GENERATE
    source_version_id: int | None = None
    instruction: str | None = None


class VideoProjectBase(BaseModel):
    # No length rule here on purpose. `app/services/work.clean_name` is the
    # single authority on what a name may be, because it is the only place
    # that can answer in Korean — a pydantic failure arrives as a list under
    # `detail`, and the frontend only renders a string.
    name: str
    prompt: str = Field(default="", max_length=4000)


class VideoProjectCreate(VideoProjectBase):
    """`selected_model_id` may be omitted, which means Auto."""

    selected_model_id: int | None = None


class VideoProjectUpdate(BaseModel):
    name: str | None = None
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
    #: Whether the final version can be downloaded. The library card has
    #: no versions to look at, and offers 최종본 다운로드 only when true.
    final_version_has_asset: bool = False
    created_at: datetime
    updated_at: datetime


class VideoProjectDetail(VideoProjectRead):
    """A single project with everything the workspace needs."""

    versions: list[VideoVersionRead] = []
    selected_model: VideoModelRead | None = None
