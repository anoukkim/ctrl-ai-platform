"""Put the three example apps on CtrlAIApps, from the server shell.

    python -m app.db.import_example_apps <관리자 아이디>

On the server (docs/deployment.md):

    docker compose -f docker-compose.prod.yml exec api python -m app.db.import_example_apps <관리자 아이디>

Reads `examples/apps/<folder>/` (in the image next to `app/`), and for each
example creates a Builder project owned by that admin, saves its files as
the project's first version and publishes it — exactly as if the admin
had pressed 게시. No AI call, no wallet, nothing charged.

**Idempotent.** An example is matched by its project name among the
admin's live projects; one that already exists is left exactly as it is,
so a second run changes nothing. Each run that imports anything writes
one audit row (the actor is "서버 운영자", as for `set_password`).
"""

from __future__ import annotations

import getpass as getpass_module
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select

from app.core.config import BACKEND_DIR, get_settings
from app.db.session import SessionLocal
from app.models import AuditAction, BuilderProject, User, UserRole
from app.services import app_publish, audit, builder_files, builder_versions

USAGE = "사용법: python -m app.db.import_example_apps <관리자 아이디>"
EXAMPLES_DIR = BACKEND_DIR / "examples" / "apps"


@dataclass(frozen=True)
class Example:
    folder: str
    name: str
    description: str
    note: str


#: The examples, in the order they appear on CtrlAIApps (newest first, so
#: the last one here is published first).
EXAMPLES: tuple[Example, ...] = (
    Example(
        "quiz",
        "AI 상식 퀴즈",
        "10문제를 15초 안에! 빨리 맞힐수록 점수가 올라가는 오락실 느낌의 퀴즈 게임이에요. 최고 점수는 내 기기에 남아요.",
        "CTRL+AI 예시 앱",
    ),
    Example(
        "focus-todo",
        "오늘의 할 일 + 집중 타이머",
        "할 일을 적고, 하나를 골라 25분 집중 · 5분 쉬기로 해치우는 앱이에요. 할 일마다 집중한 횟수가 쌓여요.",
        "CTRL+AI 예시 앱",
    ),
    Example(
        "attendance",
        "동아리 출석 체크",
        "이름을 누를 때마다 출석 · 지각 · 결석이 바뀌는 공책 느낌의 출석부예요. 날짜마다 따로 기록돼요.",
        "CTRL+AI 예시 앱",
    ),
)

#: Files an example may carry (the Builder's own rules apply as well).
_FILE_SUFFIXES = {".html", ".css", ".js"}


def example_files(example: Example, root: Path = EXAMPLES_DIR) -> dict[str, str]:
    folder = root / example.folder
    files = {
        path.name: path.read_text(encoding="utf-8")
        for path in sorted(folder.iterdir())
        if path.is_file() and path.suffix in _FILE_SUFFIXES
    }
    builder_files.check_project(files)
    for path in files:
        builder_files.clean_path(path)
    return files


def _operator() -> str:
    try:
        return getpass_module.getuser()
    except Exception:  # noqa: BLE001 — no login name in some containers
        return "unknown"


def import_examples(db, admin: User, settings, root: Path = EXAMPLES_DIR) -> list[tuple[str, str]]:
    """(name, "imported" | "unchanged") per example. Commits nothing."""
    results: list[tuple[str, str]] = []
    for example in EXAMPLES:
        existing = db.scalar(
            select(BuilderProject).where(
                BuilderProject.owner_user_id == admin.id,
                BuilderProject.name == example.name,
                BuilderProject.deleted_at.is_(None),
            )
        )
        if existing is not None:
            results.append((example.name, "unchanged"))
            continue
        files = example_files(example, root)
        project = BuilderProject(
            owner_user_id=admin.id, name=example.name, description=example.description
        )
        db.add(project)
        db.flush()
        builder_versions.replace_files(db, project, files)
        builder_versions.snapshot(db, project, "예시 앱 가져오기", files)
        app_publish.publish(
            db, settings, project, description=example.description, note=example.note
        )
        results.append((example.name, "imported"))
    imported = [name for name, outcome in results if outcome == "imported"]
    if imported:
        audit.record(
            db,
            actor=None,
            action=AuditAction.EXAMPLE_APPS_IMPORTED,
            target_type="user",
            target_id=admin.id,
            target_label=admin.username,
            summary=f"서버 운영자가 예시 앱 {len(imported)}개를 {admin.username}의 이름으로 게시했습니다: "
            + ", ".join(imported),
            detail={"imported": imported, "os_user": _operator()},
        )
    return results


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0].startswith("-"):
        print(USAGE)
        return 2
    username = argv[0].strip().lower()
    settings = get_settings()
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.username == username))
        if admin is None:
            print(f"'{username}' 계정이 없습니다.")
            return 1
        if admin.role is not UserRole.ADMIN:
            print(f"'{username}'은(는) 관리자가 아닙니다. 예시 앱은 관리자의 이름으로만 올립니다.")
            return 1
        try:
            results = import_examples(db, admin, settings)
        except app_publish.PublishError as error:
            db.rollback()
            print(f"게시하지 못했습니다: {error}")
            return 1
        db.commit()
    for name, outcome in results:
        print(f"  {'게시함' if outcome == 'imported' else '이미 있음 (그대로 둠)'}: {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
