"""example-apps — three static example apps and the server CLI that
publishes them for the admin (idempotent, audited, no charge)."""

import re
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import import_example_apps as cli
from app.models import AuditLog, BuilderProject, BuilderProjectStatus, UsageEvent
from app.services import builder_files


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(app_env="development", apps_dir=str(tmp_path / "apps"), apps_base_url="http://apps.test")


@pytest.mark.parametrize("example", cli.EXAMPLES, ids=lambda e: e.folder)
def test_each_example_is_a_small_static_korean_app_with_no_network(example) -> None:
    files = cli.example_files(example)
    assert set(files) == {"index.html", "style.css", "app.js"}
    assert sum(len(c.encode()) for c in files.values()) < builder_files.MAX_PROJECT_BYTES
    page = files["index.html"]
    assert 'lang="ko"' in page and 'name="viewport"' in page
    for content in files.values():
        # No external scripts, styles, fonts or requests — the CSP blocks them.
        assert not re.search(r"https?://", content), example.folder
        assert "fetch(" not in content and "@import" not in content
        # Dialogs are blocked in the sandboxed preview frame.
        assert not re.search(r"\b(alert|confirm|prompt)\(", content), example.folder


def test_the_examples_each_look_different() -> None:
    """F2: no shared default template — different palettes and fonts."""
    styles = [cli.example_files(example)["style.css"] for example in cli.EXAMPLES]
    backgrounds = [re.search(r"body \{[^}]*background:([^;]+);", css, re.S).group(1) for css in styles]
    fonts = [re.search(r"font-family:([^;]+);", css).group(1) for css in styles]
    assert len(set(backgrounds)) == 3 and len(set(fonts)) == 3


def test_the_cli_publishes_once_and_a_second_run_changes_nothing(
    db_session: Session, dev_user, settings, tmp_path
) -> None:
    first = cli.import_examples(db_session, dev_user, settings)
    db_session.commit()
    assert [outcome for _, outcome in first] == ["imported"] * 3

    projects = db_session.query(BuilderProject).filter_by(owner_user_id=dev_user.id).all()
    assert len(projects) == 3
    for project in projects:
        assert project.status is BuilderProjectStatus.PUBLISHED
        assert project.published_version_number == 1
        assert (Path(settings.apps_dir) / project.app_slug / "index.html").is_file()
    assert db_session.query(UsageEvent).count() == 0
    row = db_session.query(AuditLog).filter_by(action="example_apps.imported").one()
    assert row.actor_user_id is None and len(row.detail["imported"]) == 3

    second = cli.import_examples(db_session, dev_user, settings)
    db_session.commit()
    assert [outcome for _, outcome in second] == ["unchanged"] * 3
    assert db_session.query(BuilderProject).count() == 3
    assert db_session.query(AuditLog).filter_by(action="example_apps.imported").count() == 1


def test_the_cli_refuses_a_member_and_a_missing_account(monkeypatch, db_session: Session, other_user, capsys) -> None:
    from tests import conftest  # noqa: F401 — the database fixtures

    class Bound:
        def __enter__(self):
            return db_session

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(cli, "SessionLocal", lambda: Bound())
    assert cli.main([]) == 2
    assert cli.main(["nobody-here"]) == 1
    assert cli.main([other_user.username]) == 1
    assert "관리자가 아닙니다" in capsys.readouterr().out
