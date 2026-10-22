"""Image generation API schemas: the image model catalogue and a generation."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

#: The ratios the 이미지 만들기 card offers — a subset of what Gemini
#: draws, chosen so every one has a clear name in Korean.
ASPECT_RATIOS = ("1:1", "3:4", "4:3", "9:16", "16:9")
#: Gemini's own size names (uppercase K, as the API requires).
SIZES = ("1K", "2K", "4K")
MAX_PRICE_PER_IMAGE_KRW = 10_000
#: What a member (or Claude) may ask for in one picture.
MAX_PROMPT_CHARS = 2000


class CatalogError(ValueError):
    """A catalogue entry that cannot be accepted. The message is Korean."""


class ImageDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    size: str
    aspect_ratio: str


class ImageCapabilities(BaseModel):
    """Everything image creation follows for one model.

    The price is whole won per image, one per size: the card shows
    `price_per_image_krw[size]` and that is the charge. `usd_per_image` is
    the provider's list price, recorded as the event's `provider_cost` so
    Admin › 사용 분석 can put 원가 beside 청구. `prices_are_examples` marks
    seeded figures until an admin saves the model, as for video.
    """

    model_config = ConfigDict(extra="forbid")

    sizes: list[str]
    aspect_ratios: list[str]
    price_per_image_krw: dict[str, int]
    usd_per_image: dict[str, float] = Field(default_factory=dict)
    defaults: ImageDefaults
    prices_are_examples: bool = False

    @model_validator(mode="after")
    def _check(self) -> "ImageCapabilities":
        if not self.sizes:
            raise CatalogError("크기를 하나 이상 정해 주세요.")
        unknown = [s for s in self.sizes if s not in SIZES]
        if unknown:
            raise CatalogError(f"지원하지 않는 크기입니다: {', '.join(unknown)}")
        self.sizes = [s for s in SIZES if s in self.sizes]

        if not self.aspect_ratios:
            raise CatalogError("비율을 하나 이상 정해 주세요.")
        unknown = [r for r in self.aspect_ratios if r not in ASPECT_RATIOS]
        if unknown:
            raise CatalogError(f"지원하지 않는 비율입니다: {', '.join(unknown)}")
        self.aspect_ratios = [r for r in ASPECT_RATIOS if r in self.aspect_ratios]

        missing = [s for s in self.sizes if s not in self.price_per_image_krw]
        if missing:
            raise CatalogError(f"크기마다 한 장 가격이 있어야 합니다: {', '.join(missing)}")
        extra = [s for s in self.price_per_image_krw if s not in self.sizes]
        if extra:
            raise CatalogError(f"없는 크기의 가격이 들어 있습니다: {', '.join(extra)}")
        if any(not 1 <= p <= MAX_PRICE_PER_IMAGE_KRW for p in self.price_per_image_krw.values()):
            raise CatalogError(
                f"한 장 가격은 1원에서 {MAX_PRICE_PER_IMAGE_KRW:,}원 사이여야 합니다."
            )
        if any(s not in self.sizes for s in self.usd_per_image):
            raise CatalogError("없는 크기의 원가(USD)가 들어 있습니다.")
        if any(not 0 <= usd < 10 for usd in self.usd_per_image.values()):
            raise CatalogError("원가(USD)는 0에서 10 사이여야 합니다.")

        if self.defaults.size not in self.sizes:
            raise CatalogError("기본 크기는 고를 수 있는 크기 중 하나여야 합니다.")
        if self.defaults.aspect_ratio not in self.aspect_ratios:
            raise CatalogError("기본 비율은 고를 수 있는 비율 중 하나여야 합니다.")
        return self


def parse_capabilities(raw: object) -> ImageCapabilities:
    """Validate a catalogue entry, turning any failure into one Korean sentence."""
    try:
        return ImageCapabilities.model_validate(raw)
    except ValidationError as error:
        first = error.errors()[0]
        cause = (first.get("ctx") or {}).get("error")
        if isinstance(cause, CatalogError):
            raise CatalogError(str(cause)) from None
        where = ".".join(str(part) for part in first.get("loc", ())) or "설정"
        raise CatalogError(f"모델 설정의 형식이 올바르지 않습니다 ({where}).") from None


class ImageModelRead(BaseModel):
    """A model as members see it (only enabled, member-visible rows)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    model_id: str
    display_name: str
    description: str
    sort_order: int
    capabilities: ImageCapabilities


class ImageModelList(BaseModel):
    """What the 이미지 만들기 card needs: the models, and whether it may make one."""

    models: list[ImageModelRead]
    #: False while Admin › System › 기능 열기 keeps images locked.
    open: bool
    #: True while IMAGE_PROVIDER is mock: the card says the picture is a sample.
    mock: bool


class ImageModelAdminRead(ImageModelRead):
    enabled: bool
    member_visible: bool
    created_at: datetime
    updated_at: datetime


class ImageModelAdminUpdate(BaseModel):
    """What an admin may change. The model id is fixed, as for video."""

    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None
    member_visible: bool | None = None
    sort_order: int | None = None
    #: The whole entry, replaced at once; checked by `parse_capabilities`.
    capabilities: dict | None = None


class ImageCreate(BaseModel):
    """One picture from an 이미지 만들기 card. JSON body (CLAUDE.md §2)."""

    prompt: str = Field(min_length=1, max_length=MAX_PROMPT_CHARS)
    #: `ImageModel.id`; empty means the first model the member may use.
    model: int | None = None
    size: str | None = None
    aspect_ratio: str | None = None
    #: The price the card showed. When sent and no longer the catalogue's
    #: (an admin changed it meanwhile), nothing is made: 409.
    expected_krw: int | None = None
