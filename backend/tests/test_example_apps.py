"""feat-showcase-apps — the three static showcase apps (demos) and the
server CLI that publishes them for the admin, `--replace` taking the
earlier examples down (idempotent, audited, no charge)."""

import re
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import import_example_apps as cli
from app.models import AuditLog, BuilderProject, BuilderProjectStatus, UsageEvent
from app.services import app_publish, builder_files, builder_versions

#: The one URL an app may contain: the SVG namespace, which is a name, not a request.
SVG_NAMESPACE = "http://www.w3.org/2000/svg"


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(app_env="development", apps_dir=str(tmp_path / "apps"), apps_base_url="http://apps.test")


@pytest.mark.parametrize("example", cli.EXAMPLES, ids=lambda e: e.folder)
def test_each_showcase_is_a_static_korean_demo_within_the_builder_rules(example) -> None:
    files = cli.example_files(example)  # raises if any Builder rule is broken
    assert "index.html" in files and "SPEC.md" in files and "style.css" in files
    assert all(path.endswith(tuple(builder_files.ALLOWED_EXTENSIONS)) for path in files)
    assert len(files) <= builder_files.MAX_FILES
    assert all(len(c.encode()) <= builder_files.MAX_FILE_BYTES for c in files.values())
    assert sum(len(c.encode()) for c in files.values()) <= builder_files.MAX_PROJECT_BYTES

    page = files["index.html"]
    assert 'lang="ko"' in page and 'name="viewport"' in page
    # Honest about being a demo, and resettable.
    assert "데모 데이터" in page and "데모 초기화" in page
    code = "\n".join(c for path, c in files.items() if not path.endswith(".md"))
    assert "AI 연결" in code  # every AI result says it is pre-made / waits for AI
    for path, content in files.items():
        if path.endswith(".md"):
            continue
        # No external scripts, styles, fonts or requests — the CSP blocks them.
        assert not re.search(r"https?://", content.replace(SVG_NAMESPACE, "")), path
        assert not re.search(r"\bfetch\(|XMLHttpRequest|WebSocket|@import|sendBeacon", content), path
        # Dialogs are blocked in the sandboxed preview frame.
        assert not re.search(r"\b(alert|confirm|prompt)\(", content), path
    # Storage can throw in a sandboxed frame: every app guards it.
    for path, content in files.items():
        if "localStorage." in content:
            assert "try {" in content, path


def test_each_showcase_keeps_its_original_spec() -> None:
    spec = {e.folder: cli.example_files(e)["SPEC.md"] for e in cli.EXAMPLES}
    assert "App 1 — 영수증 가계부" in spec["receipt-ledger"]
    assert "App 2 — 여행 일정 메이커" in spec["trip-planner"]
    assert "App 3 — 문서 챗봇 메이커" in spec["doc-chatbot"]
    assert all("faithful STATIC DEMOS" in text for text in spec.values())


def test_the_showcases_each_look_different() -> None:
    """No shared template: each has its own background and accent."""
    roots = [re.search(r":root \{([^}]*)\}", cli.example_files(e)["style.css"]).group(1) for e in cli.EXAMPLES]
    backgrounds = [re.search(r"--bg:\s*([^;]+);", root).group(1) for root in roots]
    assert len(set(backgrounds)) == 3
    assert len(set(roots)) == 3


def test_the_showcases_use_sub_folders_and_the_runtime_serves_them(db_session: Session, dev_user, settings) -> None:
    cli.import_examples(db_session, dev_user, settings)
    db_session.commit()
    for example in cli.EXAMPLES:
        project = db_session.query(BuilderProject).filter_by(name=example.name).one()
        root = Path(settings.apps_dir) / project.app_slug
        assert (root / "index.html").is_file()
        assert (root / "js" / "app.js").is_file()
        assert (root / "SPEC.md").is_file()


def test_the_cli_publishes_once_and_a_second_run_changes_nothing(db_session: Session, dev_user, settings) -> None:
    first = cli.import_examples(db_session, dev_user, settings)
    db_session.commit()
    assert [outcome for _, outcome in first] == ["imported"] * 3

    projects = db_session.query(BuilderProject).filter_by(owner_user_id=dev_user.id).all()
    assert {p.name for p in projects} == {e.name for e in cli.EXAMPLES}
    for project in projects:
        assert project.status is BuilderProjectStatus.PUBLISHED
        assert project.published_version_number == 1
    assert db_session.query(UsageEvent).count() == 0
    row = db_session.query(AuditLog).filter_by(action="example_apps.imported").one()
    assert row.actor_user_id is None and len(row.detail["imported"]) == 3

    second = cli.import_examples(db_session, dev_user, settings, replace=True)
    db_session.commit()
    assert [outcome for _, outcome in second] == ["unchanged"] * 3
    assert db_session.query(BuilderProject).count() == 3
    assert db_session.query(AuditLog).filter_by(action="example_apps.imported").count() == 1
    assert db_session.query(AuditLog).filter_by(action="example_apps.replaced").count() == 0


def _legacy(db_session: Session, owner, settings, name: str) -> BuilderProject:
    """An earlier example app, published as `example-apps` did."""
    files = {"index.html": f"<!doctype html><title>{name}</title>"}
    project = BuilderProject(owner_user_id=owner.id, name=name, description="예전 예시")
    db_session.add(project)
    db_session.flush()
    builder_versions.replace_files(db_session, project, files)
    builder_versions.snapshot(db_session, project, "예시 앱 가져오기", files)
    app_publish.publish(db_session, settings, project, description="예전 예시", note="CTRL+AI 예시 앱")
    db_session.commit()
    return project


def test_replace_takes_the_earlier_examples_down_and_publishes_the_new_ones(
    db_session: Session, dev_user, other_user, settings
) -> None:
    old = [_legacy(db_session, dev_user, settings, name) for name in cli.LEGACY_NAMES]
    old_slugs = [p.app_slug for p in old]
    # A member's project that happens to share a name is not the admin's example.
    theirs = _legacy(db_session, other_user, settings, cli.LEGACY_NAMES[0])

    results = cli.import_examples(db_session, dev_user, settings, replace=True)
    db_session.commit()
    assert sorted(name for name, outcome in results if outcome == "removed") == sorted(cli.LEGACY_NAMES)
    assert [name for name, outcome in results if outcome == "imported"] == [e.name for e in cli.EXAMPLES]

    for project, slug in zip(old, old_slugs):
        db_session.refresh(project)
        assert project.deleted_at is not None  # soft — restorable from Deleted Items
        assert project.published_version_id is None
        assert project.status is not BuilderProjectStatus.PUBLISHED
        assert not (Path(settings.apps_dir) / slug).exists()
    listed = {p.name for p in db_session.scalars(app_publish.published_listing())}
    assert listed == {e.name for e in cli.EXAMPLES} | {theirs.name}
    db_session.refresh(theirs)
    assert theirs.deleted_at is None and theirs.status is BuilderProjectStatus.PUBLISHED

    replaced = db_session.query(AuditLog).filter_by(action="example_apps.replaced").one()
    assert replaced.actor_user_id is None and sorted(replaced.detail["removed"]) == sorted(cli.LEGACY_NAMES)
    assert db_session.query(UsageEvent).count() == 0

    again = cli.import_examples(db_session, dev_user, settings, replace=True)
    db_session.commit()
    assert [outcome for _, outcome in again] == ["unchanged"] * 3
    assert db_session.query(AuditLog).filter_by(action="example_apps.replaced").count() == 1
    assert db_session.query(AuditLog).filter_by(action="example_apps.imported").count() == 1


def test_without_replace_the_earlier_examples_stay(db_session: Session, dev_user, settings) -> None:
    old = _legacy(db_session, dev_user, settings, cli.LEGACY_NAMES[1])
    cli.import_examples(db_session, dev_user, settings)
    db_session.commit()
    db_session.refresh(old)
    assert old.deleted_at is None and old.status is BuilderProjectStatus.PUBLISHED


def test_the_cli_refuses_bad_arguments_a_member_and_a_missing_account(
    monkeypatch, db_session: Session, other_user, capsys
) -> None:
    class Bound:
        def __enter__(self):
            return db_session

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(cli, "SessionLocal", lambda: Bound())
    assert cli.main([]) == 2
    assert cli.main(["admin", "--force"]) == 2
    assert cli.main(["admin", "other"]) == 2
    assert cli.main(["nobody-here", "--replace"]) == 1
    assert cli.main([other_user.username, "--replace"]) == 1
    assert "관리자가 아닙니다" in capsys.readouterr().out


def test_update_brings_existing_examples_to_the_image_s_files_as_a_published_version(
    db_session: Session, dev_user, settings, tmp_path
) -> None:
    """project-export-handoff: `--update` is how the hand-written guides
    reach examples already on the server. Without it nothing changes; with
    it, a differing example gets one new published version, audited."""
    import shutil

    root = tmp_path / "examples"
    shutil.copytree(cli.EXAMPLES_DIR, root)
    cli.import_examples(db_session, dev_user, settings, root)
    db_session.commit()
    (root / "trip-planner" / "README.md").write_text("# 새 안내", encoding="utf-8")

    plain = cli.import_examples(db_session, dev_user, settings, root)
    assert [outcome for _, outcome in plain] == ["unchanged"] * 3

    updated = cli.import_examples(db_session, dev_user, settings, root, update=True)
    db_session.commit()
    assert dict(updated) == {"문서 챗봇 메이커": "unchanged", "여행 일정 메이커": "updated", "영수증 가계부": "unchanged"}
    trip = db_session.query(BuilderProject).filter_by(name="여행 일정 메이커").one()
    assert trip.published_version_number == 2
    assert builder_versions.current_files(db_session, trip)["README.md"] == "# 새 안내"
    assert (Path(settings.apps_dir) / trip.app_slug / "README.md").read_text(encoding="utf-8") == "# 새 안내"
    row = db_session.query(AuditLog).filter_by(action="example_apps.updated").one()
    assert row.detail["updated"] == ["여행 일정 메이커"]

    again = cli.import_examples(db_session, dev_user, settings, root, update=True)
    assert [outcome for _, outcome in again] == ["unchanged"] * 3
