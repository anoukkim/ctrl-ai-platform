"""Put the three showcase apps on CtrlAIApps, from the server shell.

    python -m app.db.import_example_apps <관리자 아이디> [--replace]

On the server (docs/deployment.md):

    docker compose -f docker-compose.prod.yml exec api python -m app.db.import_example_apps <관리자 아이디> --replace

Reads `examples/apps/<folder>/` (in the image next to `app/`, sub-folders
included), and for each example creates a Builder project owned by that
admin, saves its files as the project's first version and publishes it —
exactly as if the admin had pressed 게시. No AI call, no wallet, nothing
charged.

`--replace` first takes down the earlier example apps (the three small
ones of `example-apps`, matched by name among that admin's live
projects): each is unpublished — off CtrlAIApps and off its address — and
soft-deleted, so it can still be restored from Admin › Deleted Items.

**Idempotent.** An example is matched by its project name among the
admin's live projects; one that already exists is left exactly as it is,
and an earlier example already taken down is not found again, so a second
run changes nothing. Each run that changes anything writes audit rows
(the actor is "서버 운영자", as for `set_password`).
"""

from __future__ import annotations

import getpass as getpass_module
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.core.config import BACKEND_DIR, get_settings
from app.db.session import SessionLocal
from app.models import AuditAction, BuilderProject, User, UserRole
from app.services import app_publish, app_runtime, audit, builder_files, builder_versions

USAGE = "사용법: python -m app.db.import_example_apps <관리자 아이디> [--replace]"
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
        "doc-chatbot",
        "문서 챗봇 메이커",
        "회칙이나 안내문을 올리면 그 문서로만 답하는 챗봇을 만들어요. 답마다 출처를 붙이고, 퍼가기 코드와 "
        "관리자 통계까지 있어요. 지금은 데모 — 문서 문장을 그대로 보여 주고, AI 연결 후 Claude가 정리해요.",
        "CTRL+AI 쇼케이스 앱 · 데모",
    ),
    Example(
        "trip-planner",
        "여행 일정 메이커",
        "서울·부산·제주 중 한 곳과 기간, 예산, 취향을 고르면 하루하루 동선을 짜 줘요. 지도와 예산 도넛, "
        "끌어서 순서 바꾸기, 링크로 공유까지. 지금은 데모 플래너가 짜고, AI 연결 후 Claude가 짜요.",
        "CTRL+AI 쇼케이스 앱 · 데모",
    ),
    Example(
        "receipt-ledger",
        "영수증 가계부",
        "영수증을 올리면 상호·품목·금액을 읽어 가계부에 넣어요. 카테고리 예산, 이번 달 소비 패턴, 차트와 "
        "CSV 내보내기까지. 지금은 샘플 영수증 12장의 미리 만든 결과로 보여 주는 데모예요.",
        "CTRL+AI 쇼케이스 앱 · 데모",
    ),
)

#: The earlier examples (`example-apps`, 2026-10-14) that `--replace`
#: takes down. Matched by project name, among the admin's live projects.
LEGACY_NAMES: tuple[str, ...] = ("AI 상식 퀴즈", "오늘의 할 일 + 집중 타이머", "동아리 출석 체크")


def example_files(example: Example, root: Path = EXAMPLES_DIR) -> dict[str, str]:
    """Every file under the example's folder that the Builder accepts, by
    its path inside the project ("js/app.js"). The Builder's own rules
    (types, sizes, depth, count) are checked here, before anything is stored."""
    folder = root / example.folder
    writes = [
        (path.relative_to(folder).as_posix(), path.read_text(encoding="utf-8"))
        for path in sorted(folder.rglob("*"))
        if path.is_file() and path.suffix.lower() in builder_files.ALLOWED_EXTENSIONS
    ]
    files, _ = builder_files.apply_writes({}, writes)
    return files


def _operator() -> str:
    try:
        return getpass_module.getuser()
    except Exception:  # noqa: BLE001 — no login name in some containers
        return "unknown"


def _live_project(db, admin: User, name: str) -> BuilderProject | None:
    return db.scalar(
        select(BuilderProject).where(
            BuilderProject.owner_user_id == admin.id,
            BuilderProject.name == name,
            BuilderProject.deleted_at.is_(None),
        )
    )


def replace_legacy(db, admin: User, settings) -> list[str]:
    """Unpublish and soft-delete the earlier examples, as deleting the
    project in the Builder does. Returns their names. Commits nothing."""
    removed: list[str] = []
    for name in LEGACY_NAMES:
        project = _live_project(db, admin, name)
        if project is None:
            continue
        project.deleted_at = datetime.now(timezone.utc)
        if project.published_version_id is not None:
            app_publish.unpublish(db, settings, project)
        app_runtime.remove(settings, project)
        removed.append(name)
    db.flush()
    if removed:
        audit.record(
            db,
            actor=None,
            action=AuditAction.EXAMPLE_APPS_REPLACED,
            target_type="user",
            target_id=admin.id,
            target_label=admin.username,
            summary=f"서버 운영자가 예전 예시 앱 {len(removed)}개를 내리고 지웠습니다 (휴지통에서 되살릴 수 있음): "
            + ", ".join(removed),
            detail={"removed": removed, "os_user": _operator()},
        )
    return removed


def import_examples(
    db, admin: User, settings, root: Path = EXAMPLES_DIR, *, replace: bool = False
) -> list[tuple[str, str]]:
    """(name, "imported" | "unchanged" | "removed") per example. Commits nothing."""
    results: list[tuple[str, str]] = []
    if replace:
        results.extend((name, "removed") for name in replace_legacy(db, admin, settings))
    imported: list[str] = []
    for example in EXAMPLES:
        if _live_project(db, admin, example.name) is not None:
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
        imported.append(example.name)
        results.append((example.name, "imported"))
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


_OUTCOME = {
    "imported": "게시함",
    "unchanged": "이미 있음 (그대로 둠)",
    "removed": "예전 예시 내림 (휴지통으로)",
}


def main(argv: list[str]) -> int:
    flags = [arg for arg in argv if arg.startswith("-")]
    names = [arg for arg in argv if not arg.startswith("-")]
    if len(names) != 1 or any(flag != "--replace" for flag in flags):
        print(USAGE)
        return 2
    username = names[0].strip().lower()
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
            results = import_examples(db, admin, settings, replace="--replace" in flags)
        except (app_publish.PublishError, builder_files.FileRuleError) as error:
            db.rollback()
            print(f"게시하지 못했습니다: {error}")
            return 1
        db.commit()
    for name, outcome in results:
        print(f"  {_OUTCOME[outcome]}: {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
