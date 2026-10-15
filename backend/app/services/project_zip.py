"""Packing a Builder project into a ZIP the member can download.

Three rules from the `project-video-management` spec, and why each is
here rather than left to the caller:

* **No path may leave the project.** A ZIP entry called `../../.ssh/id_rsa`
  is a real attack on whoever unpacks it, and some unpackers still follow
  it. The paths come from our own database, so this is defence in depth —
  which is exactly the kind of check that must not be skipped on the
  grounds that the input is trusted today. Phase 3 will fill these rows
  from Claude's output, and that is not the same thing as trusted.
* **No secrets.** `.env` files, keys and certificates never go in, by
  name and by extension. A member downloading their project and mailing
  it on should not be able to leak a credential they forgot was there.
* **A size limit.** A ZIP is built in memory and then held in a response;
  without a cap one project can take the backend down.

Nothing here touches the database or HTTP. It takes `path → content`
and gives back bytes, which is what makes the rules testable
without a project, a member or a request.
"""

from __future__ import annotations

import re
import unicodedata
import zipfile
from io import BytesIO

#: Total uncompressed bytes allowed in one archive. Builder projects are
#: source trees — tens of kilobytes — so 20 MB is far above anything
#: legitimate while still bounding what one request can allocate.
MAX_TOTAL_BYTES = 20 * 1024 * 1024

#: File names that are never packed, matched on the last path segment.
SECRET_NAMES = frozenset(
    {
        ".env",
        ".env.local",
        ".env.development",
        ".env.production",
        ".env.test",
        "id_rsa",
        "id_dsa",
        "id_ecdsa",
        "id_ed25519",
        ".npmrc",
        ".netrc",
        ".pgpass",
        "credentials",
        "secrets.json",
        "serviceaccount.json",
    }
)

#: Extensions that are never packed, whatever the file is called.
SECRET_SUFFIXES = ("pem", "key", "p12", "pfx", "keystore", "jks", "asc", "gpg")

#: Directories never packed. `.git` carries full history (and often
#: credentials in its config); `node_modules` is reinstallable bulk.
SKIPPED_DIRECTORIES = frozenset({".git", "node_modules", ".next", "__pycache__", ".venv"})


class ProjectTooLargeError(Exception):
    """The project does not fit in one archive. Carries the Korean sentence."""


def is_secret(path: str) -> bool:
    """Whether this path is a credential we refuse to pack.

    `.env.anything` is covered as well as the exact names, because the
    suffix convention is open-ended — `.env.staging` is as much a secret
    as `.env.production`.
    """
    name = path.rsplit("/", 1)[-1].lower()

    if name in SECRET_NAMES or name.startswith(".env."):
        return True
    return name.rsplit(".", 1)[-1] in SECRET_SUFFIXES if "." in name else False


def is_safe_path(path: str) -> bool:
    """Whether this path stays inside the project.

    Refused: anything empty, absolute, Windows-drive-rooted, containing a
    `..` segment, a backslash (which some unpackers read as a separator),
    or a control character. A trailing or doubled slash is refused too —
    it means the path was built wrong, and guessing what was meant is how
    a `..` slips through later.
    """
    if not path or len(path) > 400:
        return False
    if path.startswith("/") or path.startswith("~"):
        return False
    if "\\" in path or "\x00" in path:
        return False
    if re.match(r"^[A-Za-z]:", path):
        return False
    if any(ord(character) < 32 for character in path):
        return False

    segments = path.split("/")
    if any(segment in ("", ".", "..") for segment in segments):
        return False

    return True


def is_skipped_directory(path: str) -> bool:
    """Whether any directory on the way to this file is one we never pack."""
    return any(segment in SKIPPED_DIRECTORIES for segment in path.split("/")[:-1])


def packable(path: str) -> bool:
    """The one question the ZIP builder asks of each file."""
    return is_safe_path(path) and not is_secret(path) and not is_skipped_directory(path)


def check_size(files: dict[str, str]) -> None:
    """Raise `ProjectTooLargeError` when `files` exceed `MAX_TOTAL_BYTES`."""
    if sum(len(content.encode("utf-8")) for content in files.values()) > MAX_TOTAL_BYTES:
        raise ProjectTooLargeError(
            "프로젝트가 너무 커서 압축 파일로 내려받을 수 없습니다. "
            "GitHub에 올려 받는 방법을 사용해 주세요."
        )


def pack(files: dict[str, str]) -> bytes:
    """Pack `path → content` into ZIP bytes, exactly these files.

    Unsafe or secret paths are dropped silently rather than refused: one
    bad row must not make the member's whole project undownloadable, and
    there is nothing they could do about it anyway. What goes in beside
    the project's own files (README, CLAUDE.md, …) is the caller's choice
    — `project_handoff` since project-export-handoff.

    Raises `ProjectTooLargeError` when the contents exceed
    `MAX_TOTAL_BYTES`.
    """
    packed = {path: content for path, content in files.items() if packable(path)}
    check_size(packed)

    buffer = BytesIO()
    # ZIP_DEFLATED because source text compresses to a fraction of its
    # size, and the member downloads this over a network.
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(packed):
            archive.writestr(path, packed[path].encode("utf-8"))

    return buffer.getvalue()


def _safe_stem(title: str) -> str:
    """The title with everything risky for a filesystem removed. May be empty."""
    stem = unicodedata.normalize("NFC", title).strip()
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", stem)
    stem = re.sub(r"\s+", " ", stem).strip(" .")
    return stem[:60].strip(" .")


def version_filename(project_name: str, label: str, extension: str) -> str:
    """A video version's download name: `<project>_v<n>.<ext>`, e.g. `probe_v8.gif`.

    Decided 2026-10-07. No date: the version label already
    tells two downloads of the same project apart, and the same version
    downloaded twice should land under the same name.
    """
    return f"{_safe_stem(project_name) or 'video'}_{label}.{extension}"
