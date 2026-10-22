"""The image generation provider — Google Gemini, behind `IMAGE_PROVIDER`.

The route never knows which implementation it has: switching
`IMAGE_PROVIDER` from `mock` to `gemini` is a configuration change
(CLAUDE.md section 7).

* **`MockImageProvider`** — the default. Draws a plausible, deterministic
  picture in the requested shape (a gradient and the prompt's first
  words), so the card, the charge, the stored file and the download all
  run end to end with no key and no spending.
* **`GeminiImageProvider`** — `models/{model}:generateContent` on the
  Gemini API with the server's key. Only a *paid* project may be used:
  Gemini's free tier keeps prompts for training (BACKLOG › image-generation
  point 6), so startup refuses `gemini` unless `GEMINI_BILLING_CONFIRMED`
  is true. Checked against a fake transport only until the owner runs it
  with a real key.

A refusal by the provider's safety filter is `ImageRefusedError`, shown in
Korean and never charged; any other failure is `ProviderUnavailableError`.
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
#: A picture takes seconds, sometimes tens of seconds; past this the
#: member is told to try again (and nothing is charged).
GEMINI_TIMEOUT_SECONDS = 120.0


class ProviderUnavailableError(Exception):
    """The provider could not make the picture. Korean message; not charged."""


class ImageRefusedError(Exception):
    """The provider's safety filter declined the prompt. Korean message; not charged."""


@dataclass(frozen=True)
class ImageRequest:
    model_id: str
    prompt: str
    size: str
    aspect_ratio: str


@dataclass(frozen=True)
class ImageResult:
    data: bytes
    media_type: str
    #: The provider's own reference, for reconciliation; may be empty.
    job_id: str = ""


class ImageGenerationProvider(Protocol):
    #: What usage events record as the provider.
    name: str

    def generate(self, request: ImageRequest) -> ImageResult: ...


# ------------------------------------------------------------------ mock

#: The long edge of each size, as Gemini draws it.
LONG_EDGE = {"1K": 1024, "2K": 2048, "4K": 4096}


def pixel_size(size: str, aspect_ratio: str) -> tuple[int, int]:
    """Width and height for a size name and a ratio such as "16:9"."""
    long_edge = LONG_EDGE.get(size, 1024)
    w, h = (int(part) for part in aspect_ratio.split(":"))
    if w >= h:
        return long_edge, max(1, round(long_edge * h / w))
    return max(1, round(long_edge * w / h)), long_edge


class MockImageProvider:
    """Plausible, deterministic, free. Nothing leaves the process.

    Prompts containing "MOCK_REFUSE" are refused and "MOCK_FAIL" fail, so
    the failure paths can be tried from the screen as well as the tests.
    """

    name = "gemini"

    #: Every prompt the mock received, newest last. Tests read it to prove a
    #: route did — or did not — reach the provider.
    calls: list[str] = []

    def generate(self, request: ImageRequest) -> ImageResult:
        from PIL import Image, ImageDraw

        MockImageProvider.calls.append(request.prompt)
        # Bounded: on a server running the mock, prompts must not pile up.
        del MockImageProvider.calls[:-50]
        if "MOCK_REFUSE" in request.prompt:
            raise ImageRefusedError(REFUSED)
        if "MOCK_FAIL" in request.prompt:
            raise ProviderUnavailableError(UNAVAILABLE)

        # Drawn small and scaled up: a 4K mock in full would take seconds
        # for a picture nobody will look at closely.
        width, height = pixel_size(request.size, request.aspect_ratio)
        digest = hashlib.sha256(f"{request.model_id}|{request.prompt}".encode()).digest()
        top = tuple(digest[0:3])
        bottom = tuple(digest[3:6])
        small_w, small_h = max(1, width // 8), max(1, height // 8)
        image = Image.new("RGB", (small_w, small_h))
        draw = ImageDraw.Draw(image)
        for y in range(small_h):
            t = y / max(1, small_h - 1)
            colour = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom, strict=True))
            draw.line([(0, y), (small_w, y)], fill=colour)
        image = image.resize((width, height))
        draw = ImageDraw.Draw(image)
        # Pillow's built-in font has no Hangul: only the ASCII words are drawn.
        words = " ".join(request.prompt.encode("ascii", "ignore").decode().split()[:6])
        label = f"CTRL+AI sample image - {request.size} {request.aspect_ratio} - {words}"
        draw.text((24, 24), label[:90], fill=(255, 255, 255))
        out = io.BytesIO()
        image.save(out, format="PNG")
        return ImageResult(
            data=out.getvalue(),
            media_type="image/png",
            job_id=f"mock-image-{len(MockImageProvider.calls)}",
        )


# ---------------------------------------------------------------- gemini

UNAVAILABLE = "이미지를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요. 돈은 빠져나가지 않았어요."
REFUSED = (
    "이 내용으로는 이미지를 만들 수 없어요 — 안전 기준에 걸렸어요. "
    "표현을 바꿔서 다시 시도해 주세요. 돈은 빠져나가지 않았어요."
)

#: `promptFeedback.blockReason` / `finishReason` values that mean the
#: safety filter said no, rather than something breaking.
_REFUSAL_REASONS = {
    "SAFETY",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "SPII",
    "RECITATION",
}


class GeminiImageProvider:
    """`POST …/models/{model}:generateContent` with `x-goog-api-key`.

    Body: the prompt as one text part, `responseModalities: ["IMAGE"]` and
    `imageConfig {aspectRatio, imageSize}`. The picture comes back as
    `candidates[0].content.parts[].inlineData {mimeType, data}` (base64).
    `post` is injectable so the request and the parser are tested without
    the network.
    """

    name = "gemini"

    def __init__(self, api_key: str, post: Callable[..., object] | None = None) -> None:
        self._api_key = api_key
        self._post = post

    def generate(self, request: ImageRequest) -> ImageResult:
        import httpx2 as httpx

        post = self._post or httpx.post
        body = {
            "contents": [{"role": "user", "parts": [{"text": request.prompt}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {"aspectRatio": request.aspect_ratio, "imageSize": request.size},
            },
        }
        try:
            response = post(
                GEMINI_URL.format(model=request.model_id),
                json=body,
                headers={"x-goog-api-key": self._api_key},
                timeout=GEMINI_TIMEOUT_SECONDS,
            )
        except Exception as error:  # noqa: BLE001 — any transport failure: not charged
            logger.warning("Gemini image call failed: %s", type(error).__name__)
            raise ProviderUnavailableError(UNAVAILABLE) from error

        status = getattr(response, "status_code", 0)
        if status != 200:
            # Never log the body: it may echo the prompt.
            logger.warning("Gemini image call answered %s", status)
            raise ProviderUnavailableError(UNAVAILABLE)
        try:
            payload = response.json()
        except ValueError as error:
            raise ProviderUnavailableError(UNAVAILABLE) from error
        return parse_gemini(payload)


def parse_gemini(payload: object) -> ImageResult:
    """The first image in a `generateContent` answer, or the right refusal."""
    if not isinstance(payload, dict):
        raise ProviderUnavailableError(UNAVAILABLE)
    feedback = payload.get("promptFeedback") or {}
    if isinstance(feedback, dict) and feedback.get("blockReason"):
        raise ImageRefusedError(REFUSED)

    candidates = payload.get("candidates") or []
    for candidate in candidates if isinstance(candidates, list) else []:
        if not isinstance(candidate, dict):
            continue
        parts = ((candidate.get("content") or {}).get("parts")) or []
        for part in parts if isinstance(parts, list) else []:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data")
            if not isinstance(inline, dict) or not inline.get("data"):
                continue
            media_type = inline.get("mimeType") or inline.get("mime_type") or "image/png"
            try:
                data = base64.b64decode(inline["data"], validate=True)
            except (ValueError, TypeError) as error:
                raise ProviderUnavailableError(UNAVAILABLE) from error
            return ImageResult(data=data, media_type=str(media_type), job_id=str(payload.get("responseId") or ""))
        if str(candidate.get("finishReason") or "") in _REFUSAL_REASONS:
            raise ImageRefusedError(REFUSED)
    # No picture and no stated reason — Gemini sometimes answers in text
    # only. Treated as a refusal-like miss: not charged, try again.
    raise ProviderUnavailableError(
        "이번에는 그림이 나오지 않았어요. 설명을 조금 바꿔서 다시 시도해 주세요. 돈은 빠져나가지 않았어요."
    )


def get_image_provider(settings: Settings) -> ImageGenerationProvider:
    """The implementation `IMAGE_PROVIDER` selects."""
    if settings.provider_is_mock("image"):
        return MockImageProvider()
    return GeminiImageProvider(settings.gemini_api_key)
