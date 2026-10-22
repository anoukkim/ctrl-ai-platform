"""What an image model allows, and what one picture costs.

The same shape as `video_catalog`: the card only offers what the chosen
model's entry lists, and this side refuses anything else rather than
quietly correcting it. The price is the catalogue's whole-won figure per
size, so the price on the card is the amount charged.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ImageModel
from app.schemas.image import CatalogError, ImageCapabilities, ImageCreate, parse_capabilities


class SettingsError(ValueError):
    """A request the model's catalogue entry does not allow. Korean message."""


@dataclass(frozen=True)
class ImageSettings:
    """The exact settings a picture is made with, after checking."""

    size: str
    aspect_ratio: str
    price_krw: int
    #: The provider's list price, for `UsageEvent.provider_cost`; None if
    #: the catalogue does not say.
    usd: float | None


def capabilities_of(model: ImageModel) -> ImageCapabilities:
    try:
        return parse_capabilities(model.capabilities)
    except CatalogError as error:
        raise SettingsError(
            f"{model.display_name} 모델의 설정이 올바르지 않습니다. 관리자에게 알려 주세요."
        ) from error


def allowed_models(db: Session) -> list[ImageModel]:
    """The models members may pick, in the admin's order."""
    return list(
        db.scalars(
            select(ImageModel)
            .where(ImageModel.enabled.is_(True), ImageModel.member_visible.is_(True))
            .order_by(ImageModel.sort_order, ImageModel.id)
        )
    )


def pick_model(db: Session, model_id: int | None) -> ImageModel:
    """The model asked for — refused unless members may use it — or the first one."""
    allowed = allowed_models(db)
    if model_id is None:
        if not allowed:
            raise SettingsError("사용할 수 있는 이미지 모델이 없습니다. 관리자에게 알려 주세요.")
        return allowed[0]
    for model in allowed:
        if model.id == model_id:
            return model
    raise SettingsError("이 이미지 모델은 지금 쓸 수 없습니다. 다른 모델을 골라 주세요.")


def resolve(model: ImageModel, asked: ImageCreate) -> ImageSettings:
    """Fill what was not sent from the model's defaults, refuse what it does not offer."""
    caps = capabilities_of(model)
    name = model.display_name

    size = asked.size or caps.defaults.size
    if size not in caps.sizes:
        raise SettingsError(f"{name} 모델은 {size} 크기를 지원하지 않습니다.")
    ratio = asked.aspect_ratio or caps.defaults.aspect_ratio
    if ratio not in caps.aspect_ratios:
        raise SettingsError(f"{name} 모델은 {ratio} 비율을 지원하지 않습니다.")
    return ImageSettings(
        size=size,
        aspect_ratio=ratio,
        price_krw=caps.price_per_image_krw[size],
        usd=caps.usd_per_image.get(size),
    )
