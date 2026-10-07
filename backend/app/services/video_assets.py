"""The file a generated version leaves behind.

The provider (`app/services/video_provider.py`) produces a `VideoAsset`;
this module stores it through the storage interface and says what to
serve it as. The mock provider's asset is a small placeholder clip from
`make_placeholder`, so the download flow is real end to end —
permissions, file name, bytes on the wire — before Higgsfield is called.

The seam is `VideoAsset`: the provider says what it produced and what to
call it. The mock makes a GIF; Higgsfield will return an MP4. The route
that serves it reads `content_type` and `extension` rather than assuming
either, so Phase 6 changes what is stored and nothing downstream.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services import placeholder_clip
from app.services.storage import AssetStorage

#: Keys look like `video/<project id>/<version id>.<ext>` — grouped by
#: project so a future "delete everything for this project" is one prefix.
KEY_TEMPLATE = "video/{project_id}/{version_id}.{extension}"


@dataclass(frozen=True)
class VideoAsset:
    """What a provider produced, and what the browser should be told it is."""

    data: bytes
    content_type: str
    extension: str


def make_placeholder(aspect_ratio: str | None) -> VideoAsset:
    """The mock provider's output: a short looping clip.

    The aspect ratio is honoured because a member who asked for 9:16 and
    downloaded a square file would reasonably think the setting did
    nothing. Everything else about the clip is deliberately plain — it is
    a placeholder, and it should look like one.
    """
    width, height = _dimensions(aspect_ratio)
    return VideoAsset(
        data=placeholder_clip.build(width=width, height=height),
        content_type="image/gif",
        extension="gif",
    )


def _dimensions(aspect_ratio: str | None) -> tuple[int, int]:
    """Pixel size for a ratio, kept small — this is a placeholder.

    An unknown or missing ratio gives a square, which is honest: nothing
    recorded what shape was wanted.
    """
    ratios = {"16:9": (96, 54), "9:16": (54, 96), "1:1": (72, 72), "4:3": (88, 66)}
    return ratios.get(aspect_ratio or "", (72, 72))


def store(storage: AssetStorage, *, project_id: int, version_id: int, asset: VideoAsset) -> str:
    """Write the asset and return the key that finds it again."""
    key = KEY_TEMPLATE.format(
        project_id=project_id, version_id=version_id, extension=asset.extension
    )
    storage.save(key, asset.data)
    return key


def content_type_for(key: str) -> str:
    """What to serve a stored key as, from its extension.

    A tiny map rather than `mimetypes`: the set of things a video
    provider can hand back is small and known, and guessing from the
    system's mime database makes the response depend on the machine.
    """
    extension = key.rsplit(".", 1)[-1].lower()
    return {
        "gif": "image/gif",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
    }.get(extension, "application/octet-stream")

