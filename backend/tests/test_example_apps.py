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
#: The outside services the example apps use (app-open-services).
OUTSIDE_ALLOWED = (
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/",
    "https://www.openstreetmap.org/copyright",
    "https://api.open-meteo.com/v1/forecast",
    "https://api.frankfurter.dev/v1/latest",
    "https://flight.naver.com/flights/",
    "https://www.google.com/travel/flights",
    "https://open-meteo.com",
    "https://frankfurter.dev",
)


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
    assert "데모" in code and "실제 AI" in code  # every AI result says which it is (P4b: 실제 AI behind a toggle)
    for path, content in files.items():
        if path.endswith(".md"):
            continue
        # Outside addresses are https only, and only the known free services
        # (app-open-services); an app still works when they do not load.
        for address in re.findall(r"https?://[^\s\"'`)<>]+", content.replace(SVG_NAMESPACE, "")):
            assert address.startswith(OUTSIDE_ALLOWED), (path, address)
        # fetch() is fine now (to the hosts above, or CTRL+AI's own /_ctrlai/); no sockets or beacons.
        assert not re.search(r"XMLHttpRequest|WebSocket|@import|sendBeacon", content), path
        # Dialogs are blocked in the sandboxed preview frame.
        assert not re.search(r"\b(alert|confirm|prompt)\(", content), path
    # Storage can throw in a sandboxed frame: every app guards it (try, or
    # inside a promise chain that catches).
    for path, content in files.items():
        if "localStorage." in content:
            assert "try {" in content or ".catch(" in content, path
    # app-platform P1: inside CTRL+AI the app keeps its data with
    # ctrlai.storage; localStorage is only the fallback outside.
    code_js = "\n".join(c for path, c in files.items() if path.endswith(".js"))
    assert "window.ctrlai.storage" in code_js and "window.ctrlai.connected" in code_js


def test_each_showcase_keeps_its_original_spec() -> None:
    spec = {e.folder: cli.example_files(e)["SPEC.md"] for e in cli.EXAMPLES}
    assert "App 1 — 출장·여행 준비 도우미" in spec["trip-prep"]
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
        # 안내 문서 stay in the project, never on the apps origin (Q3).
        assert not (root / "SPEC.md").exists()
        assert not (root / "README.md").exists()


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
    assert dict(updated) == {"문서 챗봇 메이커": "unchanged", "여행 일정 메이커": "updated", "출장·여행 준비 도우미": "unchanged"}
    trip = db_session.query(BuilderProject).filter_by(name="여행 일정 메이커").one()
    assert trip.published_version_number == 2
    assert builder_versions.current_files(db_session, trip)["README.md"] == "# 새 안내"
    assert not (Path(settings.apps_dir) / trip.app_slug / "README.md").exists()
    row = db_session.query(AuditLog).filter_by(action="example_apps.updated").one()
    assert row.detail["updated"] == ["여행 일정 메이커"]

    again = cli.import_examples(db_session, dev_user, settings, root, update=True)
    assert [outcome for _, outcome in again] == ["unchanged"] * 3


def test_each_showcase_has_a_live_mode_that_prices_before_it_charges() -> None:
    """app-platform P4b: 실제 AI priced with ctrlai.ai.estimate before any
    ctrlai.ai.ask, a demo path that stays, and AI never on load. Since
    fix-single-ai-switch (2026-10-21) the one switch is CTRL+AI's bar: an
    app follows `ctrlai.ai.mode()` and "ctrlai:ai-mode" and has no toggle
    of its own."""
    for example in cli.EXAMPLES:
        files = cli.example_files(example)
        code = "\n".join(c for path, c in files.items() if path.endswith(".js"))
        assert "ai.estimate(" in code and "ai.ask(" in code, example.folder
        assert 'id="mode-toggle"' not in files["index.html"], example.folder
        assert "ai.mode(" in code and '"ctrlai:ai-mode"' in code, example.folder
        assert "실제 AI 켜기" not in code and "setMode(" not in code, example.folder
        # ai-free-first: every AI call sits behind its own "✦ AI로 …" button (.aiBtn), next to a free path.
        assert "aiBtn" in code and ".aiBtn" in files["style.css"], example.folder
        assert "데모" in code and "실제 AI" in code, example.folder
        # Every ask sits inside a function the visitor triggers, never at the top level of a file.
        for path, content in files.items():
            if path.endswith(".js"):
                for line in content.splitlines():
                    if "ai.ask(" in line:
                        assert line.startswith("  ") and not line.startswith("  const ") or "await" in line, (path, line)
