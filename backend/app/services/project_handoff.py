"""프로젝트 내려받기 · 내 Claude로 이어서 만들기 (project-export-handoff).

A member downloads their whole Builder project and keeps building it with
their own Claude — claude.ai or Claude Code — without knowing anything
technical. The ZIP holds exactly:

* the project's files of the chosen version (작업 중 = the files as they are
  now, or 게시된 버전 = the version CtrlAIApps serves);
* `README.md` — what the app is, how to open it, one line per file, what
  lives only in the browser, three ideas for what to try next;
* `CLAUDE.md` — context for Claude Code: purpose, structure, the limits it
  was built under (and that outside CTRL+AI they no longer apply),
  conventions, how to run and check it;
* `HANDOFF_PROMPT.md` — a ready-to-paste Korean prompt for claude.ai, with
  the blank "내가 추가하고 싶은 것: ___";
* `HISTORY.md` — every kept version with its request and date;
* `SPEC.md` — only if the project has one (the showcase apps do).

**A file the project already has wins.** If the project carries its own
`README.md` (or any of the four), that one is packed and ours is not: it
is the member's — and the showcase apps use this to ship hand-written
guides in place of the generated ones.

**Nothing else.** The documents are built from the project's own name,
description, files and version notes. No owner name, no ids, no usage or
cost figures, no other member's data, nothing about CTRL+AI's internals;
the packing rules of `project_zip` (no escaping paths, no secrets, a size
cap) apply to every entry.

Nothing here touches HTTP. It takes a project and gives back a `Bundle`,
which the download route packs and the 이어서 만들기 panel describes.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BuilderProject, BuilderProjectVersion
from app.services import builder_files, builder_versions, project_zip

Which = Literal["draft", "published"]

README = "README.md"
CLAUDE = "CLAUDE.md"
PROMPT = "HANDOFF_PROMPT.md"
HISTORY = "HISTORY.md"
SPEC = "SPEC.md"
GUIDES = (README, CLAUDE, PROMPT, HISTORY)

#: The blank in the prompt that "무엇을 더 하고 싶나요?" fills.
EXTRA_LABEL = "내가 추가하고 싶은 것:"
EXTRA_BLANK = "___"
EXTRA_MARKER = f"{EXTRA_LABEL} {EXTRA_BLANK}"
MAX_EXTRA = 500

#: The first sentence to type into Claude Code.
CLAUDE_CODE_FIRST_LINE = "CLAUDE.md를 읽고, README.md의 '다음에 해 볼 만한 것' 1번부터 해 줘."

KST = timezone(timedelta(hours=9))


class HandoffError(Exception):
    """A Korean sentence for the member, and an HTTP status."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class Bundle:
    which: Which
    version_number: int
    #: path → content, exactly what the ZIP holds (packing rules applied).
    files: dict[str, str]
    #: The documents we wrote (a project's own file of the same name wins
    #: and is not listed here).
    generated: tuple[str, ...]
    prompt: str
    filename: str
    ascii_filename: str


# ------------------------------------------------------------------ helpers


def slug(name: str) -> str:
    """`영수증 가계부` → `영수증-가계부`: the project's name as a file stem.

    Korean stays (it is what the member called it, and the download header
    carries UTF-8); spaces become hyphens; everything a filesystem or shell
    reads is dropped. Falls back to `ctrlai-project`.
    """
    stem = unicodedata.normalize("NFC", name).strip().lower()
    stem = re.sub(r"\s+", "-", stem)
    stem = re.sub(r"[^\w-]", "", stem)
    stem = re.sub(r"-{2,}", "-", stem).strip("-_")[:60].strip("-_")
    return stem or "ctrlai-project"


def fill_extra(prompt: str, extra: str) -> str:
    """Put the member's "무엇을 더 하고 싶나요?" into the prompt's blank.

    Empty → the blank stays, for them to fill in claude.ai. A prompt
    without the blank (a project's own HANDOFF_PROMPT.md) gets the line
    added at the end, so the request is never silently lost.
    """
    extra = " ".join(extra.split())
    if not extra:
        return prompt
    line = f"{EXTRA_LABEL} {extra}"
    if EXTRA_MARKER in prompt:
        return prompt.replace(EXTRA_MARKER, line, 1)
    return prompt.rstrip("\n") + f"\n\n{line}\n"


def clean_extra(raw: str | None) -> str:
    extra = " ".join((raw or "").split())
    if len(extra) > MAX_EXTRA:
        raise HandoffError(f"하고 싶은 것은 {MAX_EXTRA}자까지 적을 수 있어요.")
    return extra


def _first_comment(content: str) -> str:
    """The first line of a leading `//` or `/* */` comment, if there is one."""
    text = content.lstrip("﻿ \n\r\t")
    match = re.match(r"(?://\s*(?P<line>[^\n]*))|(?:/\*+\s*(?P<block>[^\n]*?)\s*(?:\*/|\n))", text)
    if not match:
        return ""
    found = (match.group("line") or match.group("block") or "").strip(" *")
    return found[:90]


def _html_title(content: str) -> str:
    match = re.search(r"<title[^>]*>([^<]{1,90})</title>", content, re.IGNORECASE)
    return " ".join(match.group(1).split()) if match else ""


def _md_heading(content: str) -> str:
    match = re.search(r"^#\s+(.{1,90})$", content, re.MULTILINE)
    return match.group(1).strip() if match else ""


def describe(path: str, content: str) -> str:
    """One Korean line about what a file is, for README and CLAUDE.md."""
    name = path.rsplit("/", 1)[-1]
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if path == builder_files.ENTRY_FILE:
        title = _html_title(content)
        return "첫 화면 — 이 파일을 열면 앱이 시작돼요" + (f" (제목: {title})" if title else "") + "."
    if extension == "html":
        title = _html_title(content)
        return f"또 하나의 화면{f' — {title}' if title else ''}."
    if extension in ("js", "css"):
        comment = _first_comment(content)
        if comment:
            return comment if comment.endswith((".", "다", "요")) else comment + "."
        return "앱의 동작(자바스크립트)." if extension == "js" else "모양 — 색, 글꼴, 배치(CSS)."
    if name == SPEC:
        return "이 앱의 원래 기획. 서버와 실제 AI가 붙은 버전을 만들 때 쓰세요."
    if extension == "md":
        heading = _md_heading(content)
        return f"문서{f' — {heading}' if heading else ''}."
    if extension == "json":
        return "데이터(JSON)."
    if extension == "svg":
        return "그림(SVG)."
    return "글(텍스트)."


def _uses(files: dict[str, str], *needles: str) -> bool:
    return any(
        needle in content
        for path, content in files.items()
        if path.endswith((".js", ".html"))
        for needle in needles
    )


def _tree(paths: list[str]) -> str:
    """A plain folder tree, folders first at each level."""
    lines: list[str] = []
    seen: set[str] = set()
    for path in sorted(paths, key=lambda p: (p.count("/") == 0, p)):
        parts = path.split("/")
        for depth in range(len(parts) - 1):
            folder = "/".join(parts[: depth + 1])
            if folder not in seen:
                seen.add(folder)
                lines.append("  " * depth + parts[depth] + "/")
        lines.append("  " * (len(parts) - 1) + parts[-1])
    return "\n".join(lines)


def _md_cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|")


def _kst_date(moment: datetime | None) -> str:
    if moment is None:
        return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(KST).date().isoformat()


# ---------------------------------------------------------------- documents


def _ideas(files: dict[str, str]) -> list[str]:
    ideas: list[str] = []
    if SPEC in files:
        ideas.append(
            "SPEC.md의 원래 기획대로 **진짜 버전** 만들기 — 서버(예: FastAPI), 데이터베이스(예: "
            "PostgreSQL), 실제 AI(Claude API)를 붙여 데모 데이터 대신 실제로 동작하게."
        )
    else:
        ideas.append("휴대폰 화면(가로 390px)에서 더 쓰기 편하게 다듬기 — 글자 크기, 단추 크기, 한 손 조작.")
    if _uses(files, "localStorage", "ctrlai.storage"):
        ideas.append("저장한 내용을 파일로 내보내고 다시 불러오는 **백업** 기능 넣기 — 기기를 바꿔도 이어 쓸 수 있게.")
    else:
        ideas.append("입력한 내용이 새로 고쳐도 남도록 브라우저 저장(localStorage) 넣기.")
    ideas.append(
        "인터넷에 올려 친구에게 링크로 보여 주기 — GitHub Pages 같은 무료 정적 호스팅이면 파일을 그대로 올리면 돼요."
    )
    return ideas


def readme_text(name: str, description: str, files: dict[str, str], which: Which, number: int) -> str:
    listed = sorted(files) + [doc for doc in GUIDES if doc not in files]
    own = {
        README: "이 안내.",
        CLAUDE: "Claude Code가 이 프로젝트를 이해하도록 쓴 안내.",
        PROMPT: "claude.ai에 붙여 넣을 프롬프트.",
        HISTORY: "버전마다 무엇을 요청했는지.",
    }
    rows = "\n".join(
        f"| `{path}` | {_md_cell(own[path] if path in own and path not in files else describe(path, files[path]))} |"
        for path in listed
    )
    sdk = (
        "- CTRL+AI 안에서는 `ctrlai.storage`(CTRL+AI 기능 상자의 저장 공간)에 저장해요. 이 ZIP의 파일을 "
        "직접 열면 `ctrlai`가 없어서, 코드가 대신 브라우저의 localStorage에 저장해요.\n"
        if _uses(files, "ctrlai.")
        else ""
    )
    stored = (
        "## 브라우저에만 저장돼요\n\n"
        "이 앱은 입력한 내용을 이 브라우저의 저장 공간(localStorage)에 넣어요. 그래서\n\n"
        "- 같은 컴퓨터, 같은 브라우저에서만 보여요. 다른 기기나 다른 사람과는 공유되지 않아요.\n"
        f"{sdk}"
        "- `index.html`을 더블클릭해서 열 때와 `http://localhost:8000`으로 열 때는 저장 공간이 서로 달라요.\n"
        "- CTRL+AI(apps.ctrlai.my)에서 저장한 내용은 이 ZIP에 들어 있지 않아요.\n"
        if _uses(files, "localStorage", "ctrlai.storage")
        else "## 저장\n\n이 앱은 따로 저장하는 내용이 없어요. 새로 고치면 처음 상태로 돌아가요.\n"
    )
    ideas = "\n".join(f"{index}. {idea}" for index, idea in enumerate(_ideas(files), start=1))
    kind = "작업 중인 버전" if which == "draft" else "CtrlAIApps에 게시된 버전"
    return (
        f"# {name}\n\n"
        f"{description.strip() or 'CTRL+AI의 Project Builder에서 만든 웹앱이에요.'}\n\n"
        f"CTRL+AI Project Builder에서 만든 앱의 **v{number}**({kind})을 그대로 내려받은 것이에요.\n\n"
        "## 열어 보기\n\n"
        "가장 쉬운 방법: 압축을 풀고 `index.html`을 더블클릭하세요. 브라우저에서 바로 열려요.\n\n"
        "화면이 비거나 일부가 안 되면, 압축을 푼 폴더에서 터미널을 열고 아래 한 줄을 실행한 뒤 "
        "브라우저에서 http://localhost:8000 을 여세요 (파이썬이 설치되어 있어야 해요).\n\n"
        "```\npython -m http.server 8000\n```\n\n"
        "## 파일\n\n"
        "| 파일 | 하는 일 |\n| ---- | ------- |\n"
        f"{rows}\n\n"
        f"{stored}\n"
        "## 다음에 해 볼 만한 것\n\n"
        f"{ideas}\n\n"
        "## 내 Claude로 이어서 만들기\n\n"
        "- **claude.ai**: 새 대화에 이 ZIP을 첨부하고, `HANDOFF_PROMPT.md`의 글을 복사해서 붙여 넣으세요.\n"
        "- **Claude Code**: 압축을 푼 폴더에서 `claude`를 실행하고, 이렇게 말해 보세요: "
        f"\"{CLAUDE_CODE_FIRST_LINE}\"\n\n"
        "CTRL+AI 밖에서 만든 변경은 자동으로 돌아오지 않아요. 다시 올리려면 파일을 Builder에 붙여 넣거나 "
        "(나중에) GitHub 연결을 쓰세요.\n"
    )


def claude_text(name: str, description: str, files: dict[str, str]) -> str:
    lines = "\n".join(f"- `{path}` — {describe(path, files[path])}" for path in sorted(files))
    conventions = [
        "순수 HTML · CSS · JavaScript예요. 빌드 단계도, 프레임워크도, npm 패키지도 없어요.",
    ]
    if _uses(files, 'type="module"', "type='module'"):
        conventions.append("스크립트는 ES 모듈(`<script type=\"module\">`)로 불러와요.")
    elif _uses(files, "<script src"):
        conventions.append(
            "스크립트는 `index.html`에서 `<script src>`로 차례대로 불러와요. 순서가 중요해요(앞 파일이 만든 것을 뒤 파일이 써요)."
        )
    if _uses(files, "ctrlai."):
        conventions.append(
            "저장은 `ctrlai.storage`(CTRL+AI 기능 상자), `window.ctrlai`가 없으면 localStorage로 — 그 분기를 지켜 주세요."
        )
    elif _uses(files, "localStorage"):
        conventions.append("저장은 브라우저 localStorage만 써요.")
    if not _uses(files, "alert(", "confirm(", "prompt("):
        conventions.append("알림창(alert · confirm) 대신 화면 안에서 확인을 받아요.")
    conventions.append("화면에 보이는 글은 모두 한국어예요.")
    convention_lines = "\n".join(f"- {line}" for line in conventions)
    records = ["- `HISTORY.md` — 버전마다 무엇을 요청했는지 (이 앱이 어떻게 바뀌어 왔는지)."]
    if SPEC in files:
        records.append("- `SPEC.md` — 원래 기획. 서버·데이터베이스·실제 AI가 붙은 버전의 설계도로 쓰세요.")
    return (
        f"# CLAUDE.md — {name}\n\n"
        "Claude Code가 이 프로젝트에서 일을 시작할 때 읽는 안내예요.\n\n"
        "## 이 앱은\n\n"
        f"{description.strip() or name}\n\n"
        "만든 사람은 코딩을 잘 모르는 초보자예요. 설명은 쉬운 한국어로 해 주고, 파일을 바꾸기 전에 "
        "무엇을 왜 바꿀지 먼저 짧게 말해 주세요.\n\n"
        "## 파일 구조\n\n"
        f"```text\n{_tree(sorted(files))}\n```\n\n"
        f"{lines}\n\n"
        "## 만들어진 조건 (CTRL+AI 안에서)\n\n"
        "- 서버 없이 방문자의 브라우저에서만 도는 **정적 앱**: HTML · CSS · JavaScript만.\n"
        "- **네트워크 없음**: 다른 사이트에서 데이터나 스크립트·이미지를 받아 오지 않아요(CDN도 안 돼요).\n"
        f"- **크기 제한**: 파일 {builder_files.MAX_FILES}개, 파일 하나 {builder_files.MAX_FILE_BYTES // 1000}KB, "
        f"전체 {builder_files.MAX_PROJECT_BYTES // 1_000_000}MB, 폴더 깊이 {builder_files.MAX_DEPTH}단계, "
        "확장자 " + " ".join(sorted(builder_files.ALLOWED_EXTENSIONS)) + ".\n\n"
        "- **CTRL+AI 기능 상자(SDK)**: CTRL+AI에서 돌 때는 `window.ctrlai`가 있어요 — "
        "`ctrlai.storage.get/set/remove/keys/clear`(앱마다 · 방문자마다 약 1MB, 비동기). CTRL+AI가 "
        "실행할 때 스크립트를 넣어 주므로 이 폴더에는 없어요.\n\n"
        "**CTRL+AI 밖에서는 이 제한이 더 이상 적용되지 않아요.** 그 대신 `ctrlai.*`도 없어요 — 그런 호출은 "
        "localStorage나 직접 만든 서버로 바꿔야 해요(지금 코드에 localStorage로 넘어가는 길이 있으면 그대로 "
        "쓰면 돼요). 서버, 데이터베이스, npm 패키지, 외부 API를 "
        "써도 돼요. 다만 그렇게 바꾸면 CTRL+AI Builder에 다시 붙여 넣어 게시할 수는 없어요 — Builder는 위 "
        "조건의 정적 파일만 받아요. 그런 큰 변경 전에는 만든 사람에게 한 번 확인해 주세요.\n\n"
        "## 코딩 관례 (지금 코드에서 쓰는 방식)\n\n"
        f"{convention_lines}\n\n"
        "## 실행과 확인\n\n"
        "```\npython -m http.server 8000\n```\n\n"
        "그다음 http://localhost:8000 을 열어요. 자동 테스트는 아직 없어요 — 바꾼 뒤 브라우저에서 직접 눌러 "
        "보고, 개발자 도구(F12) 콘솔에 빨간 오류가 없는지 확인하세요. 기능이 커지면 테스트(예: Playwright)를 "
        "추가해도 좋아요.\n\n"
        "## 기록\n\n" + "\n".join(records) + "\n"
    )


def prompt_text(name: str, description: str, files: dict[str, str]) -> str:
    spec = (
        "SPEC.md에는 이 앱의 원래 기획이 있어. 지금 앱은 그 기획을 흉내 낸 데모라서, 원하면 그 기획대로 "
        "진짜 버전을 만들 수도 있어.\n"
        if SPEC in files
        else ""
    )
    about = " ".join(description.split())
    return (
        "첨부한 ZIP은 CTRL+AI에서 만든 내 웹앱이야.\n"
        f"- 앱 이름: {name}\n"
        + (f"- 앱 설명: {about}\n" if about else "")
        + "\n"
        "ZIP 안의 README.md와 CLAUDE.md에 앱 설명과 파일 구조가 있고, HISTORY.md에는 지금까지 어떻게 "
        "바뀌어 왔는지 적혀 있어.\n"
        f"{spec}"
        "지금은 서버 없이 브라우저에서만 돌아가는 HTML · CSS · JavaScript 앱이야. 이제는 그런 제한 없이 "
        "키워도 돼.\n\n"
        f"{EXTRA_MARKER}\n\n"
        "부탁할게:\n"
        "1. 먼저 파일들을 읽고, 이 앱이 지금 무엇을 하는지 세 줄로 정리해 줘.\n"
        "2. 내가 추가하고 싶은 것을 어떻게 만들지 쉬운 말로 계획을 보여 줘. 나는 코딩을 잘 몰라.\n"
        "3. 내가 좋다고 하면, 바뀌는 파일을 하나씩 전체 내용으로 보여 주고, 어느 폴더에 어떤 이름으로 "
        "저장하는지도 알려 줘.\n"
        "4. 마지막으로 내 컴퓨터에서 열어 확인하는 방법을 알려 줘.\n"
    )


def history_text(name: str, versions: list[BuilderProjectVersion], number: int) -> str:
    shown = [version for version in versions if version.number <= number]
    shown.sort(key=lambda version: version.number)
    rows = "\n".join(
        f"| v{version.number} | {_kst_date(version.created_at)} | "
        f"{_md_cell(version.note or '(기록 없음)')}"
        f"{_md_cell(f' — 저장한 이름: {version.label}') if version.label else ''} |"
        for version in shown
    )
    gap = ""
    if shown and shown[0].number > 1:
        gap = (
            f"v1–v{shown[0].number - 1}의 기록은 남아 있지 않아요 — CTRL+AI는 최근 "
            f"{BuilderProjectVersion.KEEP}개와 따로 저장한 버전만 보관해요.\n\n"
        )
    table = (
        "| 버전 | 날짜 | 무엇을 했나 |\n| ---- | ---- | ----------- |\n" + rows
        if rows
        else "아직 버전 기록이 없어요."
    )
    return (
        f"# {name} — 버전 기록\n\n"
        "CTRL+AI Project Builder에서 이 앱이 어떻게 바뀌어 왔는지예요. \"만들기 / 고치기\" 뒤의 글이 그때 "
        "Claude에게 한 요청이에요.\n\n"
        f"{gap}{table}\n\n"
        f"이 ZIP은 **v{number}**이에요.\n"
    )


# -------------------------------------------------------------- the bundle


def _versions(db: Session, project: BuilderProject) -> list[BuilderProjectVersion]:
    return list(
        db.scalars(
            select(BuilderProjectVersion).where(BuilderProjectVersion.project_id == project.id)
        )
    )


def bundle(db: Session, project: BuilderProject, which: Which = "draft", extra: str = "") -> Bundle:
    """Everything the ZIP holds, for the chosen version.

    Raises `HandoffError` (404) when 게시된 버전 is asked for and nothing is
    published, and `project_zip.ProjectTooLargeError` past the size cap.
    """
    extra = clean_extra(extra)
    versions = _versions(db, project)
    if which == "published":
        version = project.published_version
        if version is None:
            raise HandoffError("게시된 버전이 없어요. 작업 중인 버전을 내려받으세요.", 404)
        files = {str(path): str(content) for path, content in version.files}
        number = version.number
    else:
        files = builder_versions.current_files(db, project)
        number = max((version.number for version in versions), default=0)

    files = {path: content for path, content in files.items() if project_zip.packable(path)}
    name = project.name
    description = project.description

    generated: dict[str, str] = {}
    if README not in files:
        generated[README] = readme_text(name, description, files, which, number)
    if CLAUDE not in files:
        generated[CLAUDE] = claude_text(name, description, files)
    if PROMPT not in files:
        generated[PROMPT] = prompt_text(name, description, files)
    if HISTORY not in files:
        generated[HISTORY] = history_text(name, versions, number)

    everything = {**files, **generated}
    prompt = fill_extra(everything[PROMPT], extra)
    everything[PROMPT] = prompt
    project_zip.check_size(everything)

    stem = slug(name)
    return Bundle(
        which=which,
        version_number=number,
        files=dict(sorted(everything.items())),
        generated=tuple(sorted(generated)),
        prompt=prompt,
        filename=f"{stem}-v{number}.zip",
        ascii_filename=f"project-{project.id}-v{number}.zip",
    )
