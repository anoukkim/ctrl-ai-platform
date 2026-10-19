"""fix-stream-db-sessions (2026-10-19): a streaming route ends the request's
transaction and hands its connection back before the stream starts.

FastAPI closes a dependency's session only after a StreamingResponse ends;
a Builder run streaming during a deploy held its read lock for minutes,
the migration's ALTER TABLE queued behind it, and the site stopped.
"""

from types import SimpleNamespace

from sqlalchemy import text

from app.db.session import get_db, release_before_stream


def _request(overrides: dict) -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(dependency_overrides=overrides))


def test_the_request_session_is_closed_before_a_stream(db_session) -> None:
    db_session.execute(text("select 1"))
    assert db_session.in_transaction()
    release_before_stream(db_session, _request({}))
    assert not db_session.in_transaction()


def test_a_shared_test_session_is_only_committed(db_session) -> None:
    db_session.execute(text("select 1"))
    release_before_stream(db_session, _request({get_db: lambda: iter([db_session])}))
    assert not db_session.in_transaction()


def test_every_streaming_route_releases_its_session() -> None:
    """Each StreamingResponse in a route module is preceded by the release."""
    from pathlib import Path

    routes = Path(__file__).resolve().parents[1] / "app" / "api" / "routes"
    for path in routes.glob("*.py"):
        lines = path.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines):
            if line.strip().startswith("return StreamingResponse("):
                before = "\n".join(lines[max(0, number - 3) : number])
                assert "release_before_stream(" in before, f"{path.name}:{number + 1}"
