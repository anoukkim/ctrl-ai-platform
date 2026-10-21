"""Put the three showcase apps on CtrlAIApps, from the server shell.

    python -m app.db.import_example_apps <관리자 아이디> [--replace] [--update]

On the server (docs/deployment.md):

    docker compose -f docker-compose.prod.yml exec api python -m app.db.import_example_apps <관리자 아이디> --replace
    docker compose -f docker-compose.prod.yml exec api python -m app.db.import_example_apps <관리자 아이디> --update

Reads `examples/apps/<folder>/` (in the image next to `app/`, sub-folders
included), and for each example creates a Builder project owned by that
admin, saves its files as the project's first version and publishes it —
exactly as if the admin had pressed 게시. No AI call, no wallet, nothing
charged.

`--replace` first takes down the earlier example apps (the three small
ones of `example-apps`, matched by name among that admin's live
projects): each is unpublished — off CtrlAIApps and off its address — and
soft-deleted, so it can still be restored from Admin › Deleted Items.

`--update` (project-export-handoff) brings an example that already
exists up to the files in the image: when they differ, they become a new
version ("예시 앱 업데이트") and that version is published — the way the
hand-written README / CLAUDE.md / HANDOFF_PROMPT reached the server.
Without it an existing example is never touched.

**Idempotent.** An example is matched by its project name among the
admin's live projects; one that already exists is left exactly as it is
(or, with `--update`, left alone when its files already match),
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
from app.services import app_publish, app_runtime, audit, builder_files, builder_versions, thumbnail_render

USAGE = "사용법: python -m app.db.import_example_apps <관리자 아이디> [--replace] [--update]"
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
        "관리자 통계까지 있어요. 로그인하면 Claude가 찾은 단락을 읽고 출처를 붙여 답해요(내 지원금에서) — 아니면 데모예요.",
        "CTRL+AI 쇼케이스 앱 · 데모",
    ),
    Example(
        "trip-planner",
        "여행 일정 메이커",
        "서울·부산·제주 중 한 곳과 기간, 예산, 취향을 고르면 하루하루 동선을 짜 줘요. 지도와 예산 도넛, "
        "끌어서 순서 바꾸기, 링크로 공유까지. 로그인하면 Claude가 짜고 문장도 알아들어요(내 지원금에서) — 아니면 데모 플래너예요.",
        "CTRL+AI 쇼케이스 앱 · 데모",
    ),
    Example(
        "receipt-ledger",
        "영수증 가계부",
        "영수증을 올리면 상호·품목·금액을 읽어 가계부에 넣어요. 카테고리 예산, 이번 달 소비 패턴, 차트와 "
        "CSV 내보내기까지. 로그인하면 Claude가 사진을 읽고 분석을 써요(내 지원금에서) — 아니면 샘플 12장의 데모예요.",
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


def update_example(db, settings, project: BuilderProject, example: Example, root: Path) -> bool:
    """Make an existing example's files the image's, as a new published
    version. False (and nothing written) when they already match."""
    files = example_files(example, root)
    if builder_versions.current_files(db, project) == files:
        return False
    builder_versions.ensure_baseline(db, project)
    builder_versions.replace_files(db, project, files)
    builder_versions.snapshot(db, project, "예시 앱 업데이트", files, settings)
    # The club's own showcases run on 실제 AI for signed-in visitors (P4b).
    app_publish.publish(
        db, settings, project, description=example.description, note=example.note, ai_access="full", notify=False
    )
    return True


def import_examples(
    db, admin: User, settings, root: Path = EXAMPLES_DIR, *, replace: bool = False, update: bool = False
) -> list[tuple[str, str]]:
    """(name, "imported" | "updated" | "unchanged" | "removed") per example. Commits nothing."""
    results: list[tuple[str, str]] = []
    if replace:
        results.extend((name, "removed") for name in replace_legacy(db, admin, settings))
    imported: list[str] = []
    updated: list[str] = []
    for example in EXAMPLES:
        existing = _live_project(db, admin, example.name)
        if existing is not None:
            if update and update_example(db, settings, existing, example, root):
                updated.append(example.name)
                results.append((example.name, "updated"))
            else:
                results.append((example.name, "unchanged"))
            continue
        files = example_files(example, root)
        project = BuilderProject(
            owner_user_id=admin.id, name=example.name, description=example.description
        )
        db.add(project)
        db.flush()
        builder_versions.replace_files(db, project, files)
        builder_versions.snapshot(db, project, "예시 앱 가져오기", files, settings)
        app_publish.publish(
            db, settings, project, description=example.description, note=example.note, ai_access="full", notify=False
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
    if updated:
        audit.record(
            db,
            actor=None,
            action=AuditAction.EXAMPLE_APPS_UPDATED,
            target_type="user",
            target_id=admin.id,
            target_label=admin.username,
            summary=f"서버 운영자가 예시 앱 {len(updated)}개를 새 버전으로 바꿔 게시했습니다: "
            + ", ".join(updated),
            detail={"updated": updated, "os_user": _operator()},
        )
    return results


_OUTCOME = {
    "imported": "게시함",
    "updated": "새 버전으로 게시함",
    "unchanged": "이미 있음 (그대로 둠)",
    "removed": "예전 예시 내림 (휴지통으로)",
}


def main(argv: list[str]) -> int:
    flags = [arg for arg in argv if arg.startswith("-")]
    names = [arg for arg in argv if not arg.startswith("-")]
    if len(names) != 1 or any(flag not in ("--replace", "--update") for flag in flags):
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
            results = import_examples(
                db, admin, settings, replace="--replace" in flags, update="--update" in flags
            )
        except (app_publish.PublishError, builder_files.FileRuleError) as error:
            db.rollback()
            print(f"게시하지 못했습니다: {error}")
            return 1
        db.commit()
        # fix-thumbnail-keep: a published (or newly updated) example gets its
        # picture now, as 게시 in the Builder does — until then CtrlAIApps
        # keeps showing the previous version's. A failed render is not an
        # error: the old picture stays and Admin › Apps can take it again.
        pictures: dict[str, bool] = {}
        if thumbnail_render.enabled(settings):
            for name, outcome in results:
                project = _live_project(db, admin, name) if outcome in ("imported", "updated") else None
                if project is not None:
                    pictures[name] = thumbnail_render.render_quietly(db, settings, project)
                    db.commit()
    for name, outcome in results:
        picture = {True: " · 썸네일 찍음", False: " · 썸네일 못 찍음 (이전 사진 유지)"}.get(pictures.get(name), "")
        print(f"  {_OUTCOME[outcome]}: {name}{picture}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
