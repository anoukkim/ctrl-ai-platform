"""What a Builder project's files may be (builder-static-runtime).

Claude's output is untrusted. Every file it writes is checked here before
anything is stored: a clean relative path, a static text type, and the
size limits. Server code is refused by name — the project runs only in
visitors' browsers, never on CTRL+AI's backend (CLAUDE.md section 10),
so a `.py` or `.php` file could only ever be a mistake or an attempt.

The same rules guard the files written to the apps folder
(`app_runtime.py`): a path checked here is a path that stays inside the
app's own folder.
"""

from __future__ import annotations

import posixpath

#: Static text a browser can use as it is.
ALLOWED_EXTENSIONS = {".html", ".css", ".js", ".json", ".svg", ".md", ".txt"}
#: Code that would need a server to run — named, so the refusal can say so.
SERVER_EXTENSIONS = {
    ".py", ".php", ".rb", ".pl", ".sh", ".bash", ".ps1", ".bat", ".cmd", ".exe",
    ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".java", ".go", ".rs", ".c", ".cpp",
    ".cs", ".jsp", ".asp", ".aspx", ".cgi", ".sql", ".htaccess",
}

MAX_FILE_BYTES = 200_000
MAX_FILES = 30
MAX_PROJECT_BYTES = 2_000_000
MAX_DEPTH = 3
ENTRY_FILE = "index.html"

#: 안내 문서 (quality-tuning Q3): the guides CTRL+AI writes for the
#: member's own Claude, at the project's top level. They belong to the
#: project and its ZIP, never to the app — the runtime does not serve them
#: on apps.ctrlai.my, and the Builder groups them apart from the app files.
GUIDE_DOCS = ("README.md", "CLAUDE.md", "HANDOFF_PROMPT.md", "HISTORY.md", "SPEC.md")


def is_guide(path: str) -> bool:
    """True for a top-level 안내 문서 (README.md, CLAUDE.md, …)."""
    return path in GUIDE_DOCS


def app_files(files: dict[str, str]) -> dict[str, str]:
    """The files that make up the app itself — everything but 안내 문서."""
    return {path: content for path, content in files.items() if not is_guide(path)}


class FileRuleError(Exception):
    """A Korean sentence for the member."""


def clean_path(raw: str) -> str:
    """`raw` as a clean relative path, or `FileRuleError`.

    Forward slashes, no leading slash, no `..`, no hidden parts (a
    leading dot), at most `MAX_DEPTH` parts, and a static text type.
    """
    given = raw.strip().replace("\\", "/")
    while given.startswith("./"):
        given = given[2:]
    path = posixpath.normpath(given) if given else ""
    parts = path.split("/")
    extension = posixpath.splitext(path)[1].lower()
    if extension in SERVER_EXTENSIONS or posixpath.basename(path).lower() in SERVER_EXTENSIONS:
        raise FileRuleError(
            f"서버에서 실행하거나 빌드해야 하는 코드({raw[:60]})는 만들 수 없습니다. CTRL+AI 앱은 "
            "브라우저에서만 돌아가는 HTML · CSS · JavaScript로 만듭니다."
        )
    if (
        not path
        or given.startswith("/")
        or ".." in given.split("/")
        or ".." in parts
        or any(not part or part.startswith(".") for part in parts)
        or len(parts) > MAX_DEPTH
        or len(path) > 200
        or extension not in ALLOWED_EXTENSIONS
    ):
        raise FileRuleError(f"허용되지 않는 파일 이름이라 만들지 않았습니다: {raw[:60]}")
    return path


def apply_writes(
    current: dict[str, str], writes: list[tuple[str, str]]
) -> tuple[dict[str, str], list[str]]:
    """The project after `writes`, and the paths that changed.

    Raises `FileRuleError` — and changes nothing — if any write breaks a
    rule, or the project after them would.
    """
    result = dict(current)
    changed: list[str] = []
    for raw_path, content in writes:
        path = clean_path(raw_path)
        if len(content.encode("utf-8")) > MAX_FILE_BYTES:
            raise FileRuleError(f"{path} 파일이 너무 큽니다(200KB 초과). 더 작게 나눠 달라고 해 보세요.")
        if result.get(path) != content:
            result[path] = content
            if path not in changed:
                changed.append(path)
    check_project(result)
    return result, changed


def check_project(files: dict[str, str]) -> None:
    """The whole project's limits: file count, total size, an entry file."""
    if len(files) > MAX_FILES:
        raise FileRuleError(f"파일이 너무 많습니다(최대 {MAX_FILES}개).")
    if sum(len(content.encode("utf-8")) for content in files.values()) > MAX_PROJECT_BYTES:
        raise FileRuleError("프로젝트가 너무 큽니다(최대 2MB).")
    if files and ENTRY_FILE not in files:
        raise FileRuleError("앱의 시작 파일(index.html)이 없습니다.")
