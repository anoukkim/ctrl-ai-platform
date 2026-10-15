"""빌더 점검 (quality-tuning Q2) — the staged Builder on fixed sample ideas.

Run by the owner on the server, against whatever provider the server uses
(the real one in production), charged to the admin's own wallet like any
Builder use:

    docker compose -f docker-compose.prod.yml exec api \\
        python -m app.tools.builder_eval --ideas 5 --max-krw 3000

* `--ideas N` — the first N of the five sample ideas (1–5).
* `--max-krw M` — the most the whole run may charge. Each call's worst
  case is checked against what is left before it is made, so the total
  never passes M; ideas that no longer fit are skipped.
* `--user NAME` — the admin account to run as (default `admin`).

Each idea gets its own project ("[점검] …", kept so the owner can open
it). The Markdown report — success, seconds, won, files, self-check
fixes — is stored and shown in Admin › System › 빌더 점검, and printed.
Never run by the tests against a real provider.
"""

from __future__ import annotations

import argparse
import sys
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import SessionLocal
from app.models import BuilderEvalReport, BuilderGeneration, BuilderProject, User, UserRole
from app.services import builder_stages, builder_versions
from app.services.builder_starter import StarterError
from app.services.claude_provider import ClaudeError, get_claude_provider

#: (project name, what the member would type) — fixed, so runs compare.
IDEAS: list[tuple[str, str]] = [
    (
        "용돈 기록장",
        "용돈 기록장을 만들어 줘. 수입과 지출을 날짜·금액·메모로 적고, 이번 달 합계와 "
        "남은 돈, 카테고리별 막대그래프를 보여 줘.",
    ),
    (
        "단어 암기 카드",
        "영어 단어 암기 카드 앱. 단어와 뜻을 추가하고, 카드를 눌러 뒤집고, 맞힘/틀림을 "
        "기록해서 틀린 단어만 다시 볼 수 있게 해 줘.",
    ),
    (
        "점심 메뉴 룰렛",
        "점심 메뉴 룰렛. 메뉴를 추가하고 지울 수 있고, 돌리면 애니메이션으로 하나를 골라 "
        "주고, 최근 고른 결과 5개를 보여 줘.",
    ),
    (
        "공부 타이머",
        "뽀모도로 공부 타이머. 25분 공부 5분 휴식, 과목을 골라 기록하고 오늘 과목별 공부 "
        "시간 합계를 보여 줘.",
    ),
    (
        "여행 준비물 체크리스트",
        "여행 준비물 체크리스트. 옷·세면도구·전자기기 같은 분류별로 항목을 체크하고, "
        "진행률 막대와 '1박 2일' '해외여행' 템플릿 불러오기를 넣어 줘.",
    ),
]

USAGE = "사용법: python -m app.tools.builder_eval --ideas 5 --max-krw 3000 [--user admin]"


def evaluate(
    db: Session,
    settings: Settings,
    admin: User,
    *,
    ideas: int,
    max_krw: int,
    provider=None,
) -> BuilderEvalReport:
    """Run the ideas, store and return the report."""
    provider = provider or get_claude_provider(settings)
    is_mock = settings.provider_is_mock("claude")
    rows: list[dict] = []
    spent = 0
    for name, request in IDEAS[:ideas]:
        left = max_krw - spent
        row = {"name": name, "ok": False, "seconds": 0.0, "krw": 0, "files": 0, "fixed": [], "note": ""}
        rows.append(row)
        project = BuilderProject(owner_user_id=admin.id, name=f"[점검] {name}", description=request)
        db.add(project)
        db.commit()
        row["project_id"] = project.id
        started = time.monotonic()
        try:
            generation = builder_stages.plan(
                db, settings, provider, user=admin, project=project, request=request,
                is_mock=is_mock, spend_limit_krw=left,
            )
        except (StarterError, ClaudeError, Exception) as error:  # noqa: BLE001 — a report line either way
            db.rollback()
            row["note"] = f"계획 실패: {error}"
            row["seconds"] = time.monotonic() - started
            continue
        errors: list[str] = []

        def emit(kind: str, data: dict) -> None:
            if kind == "error":
                errors.append(str(data.get("detail", "")))

        try:
            builder_stages.run(
                db, settings, provider, user=admin, generation_id=generation.id, emit=emit,
                is_mock=is_mock, spend_limit_krw=left - generation.charged_krw,
            )
        except Exception as error:  # noqa: BLE001
            db.rollback()
            errors.append(str(error))
        db.expire_all()
        finished = db.get(BuilderGeneration, generation.id)
        row["seconds"] = time.monotonic() - started
        row["krw"] = finished.charged_krw
        row["ok"] = finished.status == "done"
        row["files"] = len(builder_versions.current_files(db, project))
        row["fixed"] = list(finished.check_fixed)
        row["note"] = "; ".join(errors) or finished.check_summary
        spent += finished.charged_krw

    report = BuilderEvalReport(
        run_by=admin.id,
        provider="mock" if is_mock else settings.claude_provider,
        ideas=len(rows),
        succeeded=sum(1 for row in rows if row["ok"]),
        total_krw=spent,
        markdown=_markdown(rows, spent, max_krw, is_mock),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def _markdown(rows: list[dict], spent: int, max_krw: int, is_mock: bool) -> str:
    lines = [
        "# 빌더 점검",
        "",
        f"- 제공자: {'mock (테스트용)' if is_mock else 'Claude (실제)'}",
        f"- 성공: {sum(1 for row in rows if row['ok'])} / {len(rows)}",
        f"- 쓴 돈: {spent:,}원 (한도 {max_krw:,}원)",
        "",
        "| 아이디어 | 결과 | 걸린 시간 | 쓴 돈 | 파일 | 점검이 고친 파일 | 메모 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        note = str(row["note"]).replace("|", "/").replace("\n", " ")[:160]
        lines.append(
            f"| {row['name']} | {'성공' if row['ok'] else '실패'} | {row['seconds']:.0f}초 "
            f"| {row['krw']:,}원 | {row['files']}개 | {', '.join(row['fixed']) or '없음'} | {note} |"
        )
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="builder_eval", add_help=True)
    parser.add_argument("--ideas", type=int, default=5)
    parser.add_argument("--max-krw", type=int, default=3000)
    parser.add_argument("--user", default="admin")
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        print(USAGE)
        return 2
    if not 1 <= args.ideas <= len(IDEAS) or args.max_krw < 1:
        print(USAGE)
        return 2
    settings = get_settings()
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.username == args.user.strip().lower()))
        if admin is None or admin.role is not UserRole.ADMIN:
            print(f"'{args.user}'은(는) 관리자 계정이 아닙니다.")
            return 1
        report = evaluate(db, settings, admin, ideas=args.ideas, max_krw=args.max_krw)
    print(report.markdown)
    print("Admin › System › 빌더 점검에서도 볼 수 있어요.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
