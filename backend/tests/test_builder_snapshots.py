"""builder-snapshots: versions are saved snapshots, 작업 steps are the undo.

A version (v1, v2, …) is made by 버전 저장, by 게시, or when a project
starts — never by a change to files. Between them a short rolling history
of steps gives 실행 취소 / 다시 실행, outside the 30-version limit. Mock
Claude only; the apps folder is a temporary directory.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import BuilderProject, BuilderProjectStep, BuilderProjectVersion, UsageEvent
from app.services import builder_versions
from app.services.claude_provider import MOCK_ACCENT, MOCK_ACCENT_NEW


@pytest.fixture
def config(tmp_path):
    settings = Settings(
        app_env="development",
        chat_mock_delay_ms=0,
        apps_dir=str(tmp_path / "apps"),
        apps_base_url="http://apps.test",
        storage_dir=str(tmp_path / "storage"),
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def project(db_session: Session, dev_user) -> BuilderProject:
    row = BuilderProject(owner_user_id=dev_user.id, name="할 일", description="")
    db_session.add(row)
    db_session.commit()
    return row


def base(project: BuilderProject) -> str:
    return f"/api/builder/projects/{project.id}"


def generate(client: TestClient, project: BuilderProject, request: str):
    response = client.post(f"{base(project)}/generate", json={"request": request})
    assert response.status_code == 200, response.text
    return response.json()


def save(client: TestClient, project: BuilderProject, label: str = ""):
    response = client.post(f"{base(project)}/versions", json={"label": label})
    assert response.status_code == 200, response.text
    return response.json()


def history(client: TestClient, project: BuilderProject) -> dict:
    return client.get(f"{base(project)}/steps").json()


def versions(client: TestClient, project: BuilderProject) -> list[int]:
    return [v["number"] for v in client.get(f"{base(project)}/versions").json()]


def css(db_session: Session, project: BuilderProject) -> str:
    db_session.expire_all()
    return builder_versions.current_files(db_session, project)["style.css"]


# ------------------------------------------------------------ saving


def test_a_version_is_only_made_by_saving(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    generate(client, project, "버튼 색을 바꿔 줘")
    generate(client, project, "제목 밑에 설명을 넣어 줘")
    assert versions(client, project) == []  # three Claude runs, no version
    assert history(client, project)["unsaved"] is True

    first = save(client, project, "처음 모습")
    assert first["created"] is True and first["version"]["number"] == 1
    assert first["version"]["label"] == "처음 모습" and first["version"]["note"] == "버전 저장"
    assert history(client, project)["unsaved"] is False

    generate(client, project, "글씨를 크게 해 줘")
    assert versions(client, project) == [1]
    assert history(client, project)["unsaved"] is True
    assert save(client, project)["version"]["number"] == 2


def test_saving_identical_files_makes_nothing(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    save(client, project)
    again = save(client, project, "또")
    assert again["created"] is False and again["version"]["number"] == 1
    assert versions(client, project) == [1]


def test_nothing_to_save_without_files(client: TestClient, project, budgeted, config) -> None:
    response = client.post(f"{base(project)}/versions", json={})
    assert response.status_code == 409 and "저장할 파일" in response.json()["detail"]


# ------------------------------------------------------------ loading


def test_loading_a_snapshot_makes_no_version_and_the_next_save_is_the_next_number(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    save(client, project)  # v1
    generate(client, project, "버튼 색을 바꿔 줘")
    save(client, project)  # v2
    assert MOCK_ACCENT_NEW in css(db_session, project)

    loaded = client.post(f"{base(project)}/versions/1/restore", json={})
    assert loaded.status_code == 200, loaded.text
    assert MOCK_ACCENT in css(db_session, project)
    assert versions(client, project) == [2, 1]  # nothing new
    state = history(client, project)
    assert state["unsaved"] is False and state["reference_version_number"] == 1
    assert state["latest_version_number"] == 2

    # Editing from the loaded v1 and saving is v3 — no branch numbers.
    generate(client, project, "제목 밑에 설명을 넣어 줘")
    assert history(client, project)["unsaved"] is True
    assert save(client, project)["version"]["number"] == 3
    assert history(client, project)["reference_version_number"] == 3


def test_unsaved_work_is_measured_against_the_loaded_version(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    save(client, project)  # v1
    generate(client, project, "버튼 색을 바꿔 줘")
    save(client, project)  # v2
    client.post(f"{base(project)}/versions/1/restore", json={})
    assert history(client, project)["unsaved"] is False
    # Undoing out of the load lands on v2's files: the project stands on v2
    # again, so nothing is unsaved and saving would not copy v2.
    undo = [s for s in history(client, project)["steps"] if not s["current"]][-1]
    client.post(f"{base(project)}/steps/{undo['seq']}/restore", json={})
    state = history(client, project)
    assert state["unsaved"] is False and state["reference_version_number"] == 2
    assert save(client, project)["created"] is False


def test_loading_with_unsaved_work_can_be_undone(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    save(client, project)  # v1
    generate(client, project, "버튼 색을 바꿔 줘")  # unsaved work
    worked = css(db_session, project)
    client.post(f"{base(project)}/versions/1/restore", json={})
    assert css(db_session, project) != worked

    state = history(client, project)
    assert state["can_undo"] is True
    before = [s for s in state["steps"] if not s["current"]][-1]
    client.post(f"{base(project)}/steps/{before['seq']}/restore", json={})
    assert css(db_session, project) == worked  # nothing was lost


# ------------------------------------------------------------ steps


def test_undo_and_redo_walk_the_steps_for_free_and_a_new_change_ends_redo(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    generate(client, project, "버튼 색을 바꿔 줘")
    spent = db_session.query(UsageEvent).count()
    assert MOCK_ACCENT_NEW in css(db_session, project)

    steps = history(client, project)["steps"]
    previous = [s for s in steps if not s["current"]][-1]
    client.post(f"{base(project)}/steps/{previous['seq']}/restore", json={})
    assert MOCK_ACCENT in css(db_session, project)
    state = history(client, project)
    assert state["can_redo"] is True and [s["current"] for s in state["steps"]][-2] is True

    redo = state["steps"][-1]
    client.post(f"{base(project)}/steps/{redo['seq']}/restore", json={})
    assert MOCK_ACCENT_NEW in css(db_session, project)
    assert db_session.query(UsageEvent).count() == spent  # free
    assert versions(client, project) == []  # and no version

    # Undo, then change something else: the old "redo" is gone.
    client.post(f"{base(project)}/steps/{previous['seq']}/restore", json={})
    generate(client, project, "제목 밑에 설명을 넣어 줘")
    assert history(client, project)["can_redo"] is False
    assert redo["seq"] not in [s["seq"] for s in history(client, project)["steps"]]
    assert client.post(f"{base(project)}/steps/{redo['seq']}/restore", json={}).status_code == 404


def test_steps_are_a_short_rolling_history_outside_the_thirty_versions(
    db_session: Session, project
) -> None:
    builder_versions.replace_files(db_session, project, {"index.html": "0"})
    for i in range(1, 60):
        builder_versions.replace_files(db_session, project, {"index.html": str(i)})
        builder_versions.record_step(db_session, project, f"단계 {i}")
    db_session.commit()
    steps = builder_versions.list_steps(db_session, project)
    assert len(steps) == BuilderProjectStep.KEEP + 1  # the current one and 20 to undo
    assert steps[-1].seq == project.step_seq and dict(steps[-1].files) == {"index.html": "59"}
    # Not versions: the version table and its limit are untouched.
    assert db_session.query(BuilderProjectVersion).count() == 0
    for i in range(35):
        builder_versions.snapshot(db_session, project, f"v{i}", {"index.html": str(i)})
    db_session.commit()
    assert len(builder_versions.list_versions(db_session, project)) == BuilderProjectVersion.KEEP
    assert len(builder_versions.list_steps(db_session, project)) == BuilderProjectStep.KEEP + 1


def test_steps_of_someone_elses_project_are_not_found(
    other_client: TestClient, project, other_participating, config
) -> None:
    assert other_client.get(f"{base(project)}/steps").status_code == 404
    assert other_client.post(f"{base(project)}/versions", json={}).status_code == 404
    assert other_client.post(f"{base(project)}/steps/1/restore", json={}).status_code == 404


# ------------------------------------------------------------ 게시


def test_publishing_saves_the_working_copy_as_the_next_version(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    published = client.post(f"{base(project)}/publish", json={"description": "설명이에요"})
    assert published.status_code == 200, published.text
    assert published.json()["published_version_number"] == 1  # a row to point at
    assert versions(client, project) == [1]

    # Nothing changed since: an update re-publishes the same version.
    again = client.post(f"{base(project)}/publish", json={"description": "설명이에요"})
    assert again.json()["published_version_number"] == 1 and versions(client, project) == [1]

    generate(client, project, "버튼 색을 바꿔 줘")
    update = client.post(f"{base(project)}/publish", json={"description": "설명이에요"})
    assert update.json()["published_version_number"] == 2
    assert history(client, project)["unsaved"] is False

    # The published version is never pruned.
    db_session.expire_all()
    pinned = db_session.get(BuilderProject, project.id).published_version_id
    for i in range(40):
        builder_versions.snapshot(db_session, db_session.get(BuilderProject, project.id), f"x{i}", {"index.html": str(i)})
    db_session.commit()
    assert db_session.get(BuilderProjectVersion, pinned) is not None


def test_the_unsaved_summary_is_not_kept_on_a_saved_version(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    generate(client, project, "할 일 앱을 만들어 줘")
    save(client, project)
    generate(client, project, "버튼 색을 바꿔 줘")  # unsaved on top of v1
    assert client.post(f"{base(project)}/publish-summary", json={}).status_code == 200
    db_session.expire_all()
    latest = builder_versions.latest(db_session, project)
    assert latest.summary_description is None  # v1's text is not v1-plus-changes' text


# ------------------------------------------------------------ the migration


def test_the_migration_keeps_every_existing_version_and_adds_the_step_tables() -> None:
    path = next(Path("alembic/versions").glob("c5a8e1f3b7d9_*.py"))
    spec = importlib.util.spec_from_file_location("builder_snapshots_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("builder_projects", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table("builder_generations", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table(
        "builder_project_versions",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("project_id", sa.Integer, nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("note", sa.String(200), nullable=False),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(metadata.tables["builder_projects"].insert(), [{"id": 1}])
        connection.execute(
            metadata.tables["builder_project_versions"].insert(),
            [{"id": i, "project_id": 1, "number": i, "note": f"고치기 {i}"} for i in range(1, 8)],
        )
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        # SQLite cannot ALTER a foreign key in; PostgreSQL (the real target) can.
        operations.create_foreign_key = lambda *args, **kwargs: None
        migration.op = operations
        migration.upgrade()

    inspector = sa.inspect(engine)
    assert "builder_project_steps" in inspector.get_table_names()
    assert {"step_seq", "base_version_number"} <= {c["name"] for c in inspector.get_columns("builder_projects")}
    assert "step_id" in {c["name"] for c in inspector.get_columns("builder_generations")}
    with engine.connect() as connection:
        rows = connection.execute(sa.text("select number, note from builder_project_versions order by number")).all()
        assert [row.number for row in rows] == list(range(1, 8)) and rows[3].note == "고치기 4"
        assert connection.execute(sa.text("select step_seq, base_version_number from builder_projects")).one() == (None, None)
    engine.dispose()
