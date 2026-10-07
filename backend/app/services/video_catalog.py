"""What a model allows, and what it costs.

Every generation, edit and extension is checked here against the chosen
model's catalogue entry before anything is called or charged. The browser
only shows the options a model offers, but a browser can send anything —
so the same rules are enforced on this side, and a request outside the
catalogue is refused rather than quietly corrected.

The price is the catalogue's: `seconds x price_per_second_krw[resolution]`.
The workspace computes the same figure for its estimate, from the same
catalogue entry, so the estimate a member sees is the amount charged.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models import VideoModel
from app.schemas.video import CatalogError, VideoCapabilities, VideoVersionCreate, parse_capabilities


class SettingsError(ValueError):
    """A request the model's catalogue entry does not allow. Korean message."""


@dataclass(frozen=True)
class GenerationSettings:
    """The exact settings a version is made with, after checking."""

    duration_seconds: int
    aspect_ratio: str
    resolution: str
    sound: bool


def capabilities_of(model: VideoModel) -> VideoCapabilities:
    """The model's catalogue entry, validated.

    A row that does not validate is a catalogue problem, not the member's:
    the message says to ask an admin rather than to change a setting.
    """
    try:
        return parse_capabilities(model.capabilities)
    except CatalogError as error:
        raise SettingsError(
            f"{model.display_name} 모델의 설정이 올바르지 않습니다. 관리자에게 알려 주세요."
        ) from error


def resolve_generation(model: VideoModel, asked: VideoVersionCreate) -> GenerationSettings:
    """Fill what was not sent from the model's defaults, refuse what it does not offer."""
    caps = capabilities_of(model)
    name = model.display_name

    duration = asked.duration_seconds or caps.defaults.duration_seconds
    if duration not in caps.durations:
        raise SettingsError(f"{name} 모델은 {duration}초를 지원하지 않습니다.")

    aspect = asked.aspect_ratio or caps.defaults.aspect_ratio
    if aspect not in caps.aspect_ratios:
        raise SettingsError(f"{name} 모델은 {aspect} 비율을 지원하지 않습니다.")

    resolution = asked.resolution or caps.defaults.resolution
    if resolution not in caps.resolutions:
        raise SettingsError(f"{name} 모델은 {resolution} 화질을 지원하지 않습니다.")

    sound = caps.defaults.sound if asked.sound is None else asked.sound
    if sound and not caps.sound:
        raise SettingsError(f"{name} 모델은 소리를 지원하지 않습니다.")

    return GenerationSettings(
        duration_seconds=duration, aspect_ratio=aspect, resolution=resolution, sound=sound
    )


def cost_krw(model: VideoModel, resolution: str, seconds: int) -> int:
    """What `seconds` of video at `resolution` costs on this model, in won."""
    caps = capabilities_of(model)
    price = caps.price_per_second_krw.get(resolution)
    if price is None:
        raise SettingsError(f"{model.display_name} 모델은 {resolution} 화질을 지원하지 않습니다.")
    return price * seconds
