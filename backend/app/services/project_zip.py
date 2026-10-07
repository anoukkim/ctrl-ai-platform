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

Nothing here touches the database or HTTP. It takes `(path, content)`
pairs and gives back bytes, which is what makes the rules testable
without a project, a member or a request.
"""

from __future__ import annotations

import re
import unicodedata
import zipfile
from datetime import date
from io import BytesIO

#: Total uncompressed bytes allowed in one archive. Builder projects are
#: source trees — tens of kilobytes — so 20 MB is far above anything
#: legitimate while still bounding what one request can allocate.
MAX_TOTAL_BYTES = 20 * 1024 * 1024

#: The guide file, always added under this name.
#:
#: Deliberately not `README.md`: the project may have its own, and
#: overwriting a member's README with ours would be a small theft. A
#: Korean name also makes it obvious which file CTRL+AI wrote.
GUIDE_NAME = "CTRL+AI-안내.md"

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


def guide_text(project_name: str, file_count: int) -> str:
    """The short Korean guide packed with every project.

    It says what the member has and what to do with it. When the project
    has no files yet it says *that* instead of pretending — a guide
    explaining how to run code that is not in the archive would be worse
    than no guide.
    """
    header = f"# {project_name}\n\nCTRL+AI의 Project Builder에서 내려받은 프로젝트입니다.\n"

    if file_count == 0:
        return (
            header
            + "\n## 아직 파일이 없습니다\n\n"
            "이 프로젝트에는 저장된 코드 파일이 없어, 이 안내 파일만 들어 있습니다.\n"
            "Claude가 코드를 만들어 주는 기능은 아직 준비 중이며, 만들어진 파일은\n"
            "이 압축 파일에 함께 담기게 됩니다.\n"
        )

    return (
        header
        + f"\n파일 {file_count}개가 원래의 폴더 구조대로 들어 있습니다.\n"
        "\n## 열어 보기\n\n"
        "압축을 풀고 폴더를 편집기(예: VS Code)에서 열면 바로 내용을 볼 수 있습니다.\n"
        "\n## 실행해 보기\n\n"
        "`package.json`이 있으면 Node.js가 설치된 상태에서 폴더 안에서 다음을\n"
        "차례로 실행합니다.\n\n"
        "```\nnpm install\nnpm run dev\n```\n"
        "\n## 참고\n\n"
        "- 비밀값이 담기는 파일(`.env` 등)과 `node_modules`, `.git`은 담지 않습니다.\n"
        "- CTRL+AI에서 프로젝트를 지워도 이 압축 파일은 그대로 남습니다.\n"
    )


def build(project_name: str, files: list[tuple[str, str]]) -> bytes:
    """Pack a project into ZIP bytes.

    `files` is `(path, content)` in any order. Unsafe or secret paths are
    dropped silently rather than refused: one bad row must not make the
    member's whole project undownloadable, and there is nothing they could
    do about it anyway.

    Raises `ProjectTooLargeError` when the contents exceed
    `MAX_TOTAL_BYTES`.
    """
    packed: list[tuple[str, bytes]] = []
    total = 0

    for path, content in sorted(files):
        if not packable(path):
            continue

        payload = content.encode("utf-8")
        total += len(payload)
        if total > MAX_TOTAL_BYTES:
            raise ProjectTooLargeError(
                "프로젝트가 너무 커서 압축 파일로 내려받을 수 없습니다. "
                "GitHub에 올려 받는 방법을 사용해 주세요."
            )
        packed.append((path, payload))

    buffer = BytesIO()
    # ZIP_DEFLATED because source text compresses to a fraction of its
    # size, and the member downloads this over a network.
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(GUIDE_NAME, guide_text(project_name, len(packed)))
        for path, payload in packed:
            archive.writestr(path, payload)

    return buffer.getvalue()


def safe_filename(title: str, when: date, extension: str) -> str:
    """A readable download name: the title, the date, and nothing risky.

    The member sees this in their downloads folder, so the project's own
    name belongs in it — `가계부-2026-10-07.zip`, not `project-11.zip`.

    Korean is kept: it is what the member called the thing, and
    `Content-Disposition` can carry UTF-8. What is removed is everything
    that means something to a filesystem or a shell — separators, quotes,
    wildcards, control characters — plus leading dots, so the file cannot
    land as a hidden one.

    Falls back to a generic stem when nothing survives, which happens if
    the name was entirely punctuation.
    """
    # NFC first: Korean typed on macOS arrives decomposed, and a
    # decomposed name displays correctly but sorts and matches oddly.
    stem = unicodedata.normalize("NFC", title).strip()
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", stem)
    stem = re.sub(r"\s+", " ", stem).strip(" .")
    # Keep the name short enough for every filesystem once the date and
    # extension are added.
    stem = stem[:60].strip(" .")

    if not stem:
        stem = "ctrlai"

    return f"{stem}-{when.isoformat()}.{extension}"
