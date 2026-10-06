"""Where generated files live.

The spec for `project-video-management` asks for this shape in so many
words: "Files go through a storage interface: local folder in
development, cloud storage later (Phase 9), so nothing changes when we go
live."

So routes never touch a path. They ask the storage for a key and get
bytes back, and in Phase 9 `STORAGE_BACKEND` selects a bucket instead of a
folder without a single route changing — the same arrangement as the four
provider settings (CLAUDE.md section 20).

**A key is not a path.** It is a `/`-separated name the storage is free to
map wherever it likes. `LocalAssetStorage` maps it under one root
directory, and refuses any key that could climb out of it. That check is
the reason this module is worth having at its own name: a generated file
name reaching the filesystem unchecked is how a service ends up writing
outside its own directory.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

from app.core.config import BACKEND_DIR, Settings

#: A key segment: letters, digits, dash, underscore, dot. No spaces, no
#: separators of any other kind, and `..` is excluded by the dot rule
#: below rather than by matching it.
_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class StorageKeyError(ValueError):
    """A key that is not safe to store under."""


def check_key(key: str) -> str:
    """Return the key if it is safe, or raise.

    Refused: anything empty or over-long, any absolute or
    drive-rooted form, any backslash, and any segment that is `.`, `..`,
    starts with a dot, or carries a character outside the allowed set.
    Leading-dot segments go too, so a key can never produce a hidden file.

    This is strict on purpose. Keys are built by this application, never
    supplied by a member, so there is no legitimate key this rejects —
    which makes a rejection a bug worth hearing about rather than a
    member's problem.
    """
    if not key or len(key) > 300:
        raise StorageKeyError(f"저장 키가 올바르지 않습니다: {key!r}")
    if "\\" in key or key.startswith("/") or re.match(r"^[A-Za-z]:", key):
        raise StorageKeyError(f"저장 키가 올바르지 않습니다: {key!r}")

    for segment in key.split("/"):
        if not _SEGMENT.match(segment):
            raise StorageKeyError(f"저장 키가 올바르지 않습니다: {key!r}")

    return key


class AssetStorage(Protocol):
    """What the rest of the application may ask of storage.

    Four methods, deliberately: anything richer (listing, signed URLs,
    ranges) would be shaped by whichever backend was written first, and
    the point of the interface is that the backend can change.
    """

    def save(self, key: str, data: bytes) -> str: ...

    def load(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...

    def delete(self, key: str) -> None: ...


class LocalAssetStorage:
    """Files under one directory on this machine. The development default.

    The directory is created on first write rather than at startup: a
    backend that only serves requests should not leave an empty folder
    behind on every machine that imports it.
    """

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        path = (self.root / check_key(key)).resolve()

        # Belt and braces. `check_key` already makes escape impossible;
        # this catches the case where the root itself is reached through
        # a symlink that points elsewhere.
        if not path.is_relative_to(self.root.resolve()):
            raise StorageKeyError(f"저장 키가 올바르지 않습니다: {key!r}")
        return path

    def save(self, key: str, data: bytes) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def load(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


def storage_root(settings: Settings) -> Path:
    """Where `LocalAssetStorage` keeps its files.

    A relative `STORAGE_DIR` is resolved against `backend/`, so the
    server finds the same folder whichever directory it was started from
    — the same reasoning as the `.env` paths in `config.py`.
    """
    configured = Path(settings.storage_dir)
    return configured if configured.is_absolute() else BACKEND_DIR / configured


def get_storage(settings: Settings) -> AssetStorage:
    """The storage this configuration selects.

    One backend today. Phase 9 adds the cloud one here and sets
    `STORAGE_BACKEND`; if that needs a change anywhere else, this
    interface was drawn in the wrong place.
    """
    backend = settings.storage_backend.strip().lower()

    if backend == "local":
        return LocalAssetStorage(storage_root(settings))

    raise ValueError(f"알 수 없는 STORAGE_BACKEND 값입니다: {settings.storage_backend!r}")
