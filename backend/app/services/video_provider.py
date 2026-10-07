"""The video generation provider — Higgsfield, behind `VIDEO_PROVIDER`.

Every generation, edit and extension goes through one of these. The route
never knows which implementation it has: switching `VIDEO_PROVIDER` from
`mock` to `higgsfield` is a configuration change (CLAUDE.md section 20).

* **`MockVideoProvider`** — the default. Supports all three operations
  and returns a small placeholder clip in the requested shape, so the
  version loop, the download and the budget deduction all run end to end
  with no key and no spending.
* **`HiggsfieldProvider`** — not built. Selecting it refuses every call
  with `ProviderUnavailableError` *before* anything is charged. The real
  adapter is Phase 6's to write; until then nothing in this codebase
  contacts Higgsfield.

Whether a *model* supports edit or extend is the catalogue's business
(`supports_edit`, `supports_extend`), checked by the route before the
provider is asked. The provider answers for the provider.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings
from app.services import video_assets
from app.services.video_assets import VideoAsset


class ProviderUnavailableError(Exception):
    """The configured provider cannot serve the request. Korean message."""


@dataclass(frozen=True)
class GenerateRequest:
    model_id: str
    prompt: str
    duration_seconds: int
    aspect_ratio: str
    resolution: str
    sound: bool


@dataclass(frozen=True)
class EditRequest:
    model_id: str
    #: The source version's file, as CTRL+AI stored it.
    source: bytes
    instruction: str
    aspect_ratio: str
    resolution: str


@dataclass(frozen=True)
class ExtendRequest:
    model_id: str
    source: bytes
    prompt: str
    #: The seconds to *add*, not the new total.
    duration_seconds: int
    aspect_ratio: str
    resolution: str


@dataclass(frozen=True)
class ProviderResult:
    asset: VideoAsset
    #: The provider's job id, kept on the version for reconciliation.
    job_id: str


class VideoGenerationProvider(Protocol):
    #: What usage events and versions record as the provider.
    name: str

    def generate(self, request: GenerateRequest) -> ProviderResult: ...

    def edit(self, request: EditRequest) -> ProviderResult: ...

    def extend(self, request: ExtendRequest) -> ProviderResult: ...


class MockVideoProvider:
    """Plausible, deterministic, free. Nothing leaves the process."""

    name = "higgsfield"

    #: Every call the mock received, newest last. Tests read it to prove a
    #: route did — or did not — reach the provider.
    calls: list[str] = []

    def _result(self, operation: str, aspect_ratio: str) -> ProviderResult:
        MockVideoProvider.calls.append(operation)
        return ProviderResult(
            asset=video_assets.make_placeholder(aspect_ratio),
            job_id=f"mock-{operation}-{len(MockVideoProvider.calls)}",
        )

    def generate(self, request: GenerateRequest) -> ProviderResult:
        return self._result("generate", request.aspect_ratio)

    def edit(self, request: EditRequest) -> ProviderResult:
        return self._result("edit", request.aspect_ratio)

    def extend(self, request: ExtendRequest) -> ProviderResult:
        return self._result("extend", request.aspect_ratio)


class HiggsfieldProvider:
    """The real adapter's place. Refuses rather than pretending."""

    name = "higgsfield"

    def _refuse(self) -> ProviderResult:
        raise ProviderUnavailableError(
            "Higgsfield 실제 연동은 아직 만들어지지 않았습니다. 관리자에게 알려 주세요."
        )

    def generate(self, request: GenerateRequest) -> ProviderResult:
        return self._refuse()

    def edit(self, request: EditRequest) -> ProviderResult:
        return self._refuse()

    def extend(self, request: ExtendRequest) -> ProviderResult:
        return self._refuse()


def get_video_provider(settings: Settings) -> VideoGenerationProvider:
    """The implementation `VIDEO_PROVIDER` selects."""
    if settings.provider_is_mock("video"):
        return MockVideoProvider()
    return HiggsfieldProvider()
