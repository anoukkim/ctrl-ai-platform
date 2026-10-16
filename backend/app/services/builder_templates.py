"""The Builder's start-screen templates (app-platform P4).

Four small, hand-written apps that each use the CTRL+AI 기능 상자 the
right way — AI 챗봇 (`ctrlai.ai` + storage), 투표·설문 and 동아리 게시판
(shared `ctrlai.db` lists), 랭킹 게임 (a shared list, playable signed
out). A member picks one on the Builder's start screen and gets a project
whose first version is the template's files: no Claude call, nothing
charged, and the next request to Claude changes it like any other app.

Each template ships its `ctrlai.json` where it uses `ctrlai.db`, has a
demo path for signed-out visitors (the basis of `app-ai-access`), and
uses no library — `app-libraries` is reviewed after P4.

The files live in `backend/examples/templates/<key>/`, next to the
showcase apps, and are read fresh on every use.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.config import BACKEND_DIR
from app.services import builder_files

TEMPLATES_DIR = BACKEND_DIR / "examples" / "templates"


@dataclass(frozen=True)
class Template:
    key: str
    name: str
    #: One Korean line for the start screen.
    description: str
    #: What of the 기능 상자 it uses, as the start screen shows them.
    uses: tuple[str, ...]


TEMPLATES: tuple[Template, ...] = (
    Template(
        "ai-chatbot",
        "AI 챗봇",
        "이름과 말투를 정한 나만의 챗봇. 회원이 로그인하면 Claude가 답하고, 아니면 데모로 보여 줘요.",
        ("AI", "로그인", "저장"),
    ),
    Template(
        "poll",
        "투표·설문",
        "질문과 보기를 올리면 회원들이 한 표씩. 결과는 막대로 바로 보여요.",
        ("공유 데이터", "로그인"),
    ),
    Template(
        "ranking-game",
        "랭킹 게임",
        "20초 색 맞추기 게임. 누구나 할 수 있고, 로그인하면 점수를 랭킹에 올려요.",
        ("공유 데이터", "로그인"),
    ),
    Template(
        "club-board",
        "동아리 게시판",
        "공지·자유·질문 글과 댓글. 쓴 사람이 고치고, 이상한 글은 신고해요.",
        ("공유 데이터", "로그인", "신고"),
    ),
)


def get(key: str) -> Template | None:
    return next((template for template in TEMPLATES if template.key == key), None)


def files_of(template: Template) -> dict[str, str]:
    """The template's files, checked by the same rules as any project."""
    folder = TEMPLATES_DIR / template.key
    files: dict[str, str] = {}
    for path in sorted(folder.rglob("*")):
        if path.is_file() and not path.name.startswith("."):
            files[builder_files.clean_path(path.relative_to(folder).as_posix())] = path.read_text(encoding="utf-8")
    builder_files.check_project(files)
    return files
