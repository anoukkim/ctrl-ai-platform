"""Image generation (image-generation): the image model catalogue.

A generated image is not a project of its own: it is a chat attachment on
the reply that offered it (`ChatAttachment.generated`). Only the catalogue
lives here.
"""

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin


class ImageModel(TimestampMixin, Base):
    """One image model a provider offers.

    Shaped like `VideoModel`: the list lives in the database and an admin
    decides what members may use. Members are only ever offered rows where
    `enabled` AND `member_visible` are both true.
    """

    __tablename__ = "image_models"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: "gemini" today. Recorded on every usage event, so Admin › 사용 분석
    #: shows image spending as its own provider line.
    provider: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    #: The identifier the provider's API expects.
    model_id: Mapped[str] = mapped_column(String(120), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    member_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    #: Sizes, ratios, the price per image for each size (won, and the
    #: provider's USD figure) and the defaults. Validated on every write by
    #: `ImageCapabilities` in `app/schemas/image.py`.
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    def __repr__(self) -> str:
        return f"<ImageModel {self.provider}/{self.model_id} enabled={self.enabled}>"
