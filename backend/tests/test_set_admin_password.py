"""`python -m app.db.set_admin_password` — the owner's recovery door.

The password comes from a hidden prompt (getpass, monkeypatched here),
must satisfy bootstrap's strength rules, works on admin accounts only,
ends the account's sessions and lifts its sign-in lockout.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.core.security import verify_password
from app.db import set_admin_password
from app.models import AuditLog, LoginAttempt, User, UserSession


STRONG = "correct-horse-battery-2026!"


@pytest.fixture(autouse=True)
def cli_session(db_session, monkeypatch):
    """The CLI opens its own session; point it at the test's."""
    monkeypatch.setattr(set_admin_password, "SessionLocal", lambda: db_session)
    # The test session must survive the CLI's close().
    monkeypatch.setattr(db_session, "close", lambda: None)
    yield


def answers(monkeypatch, *values):
    given = iter(values)
    monkeypatch.setattr(set_admin_password, "getpass", lambda prompt: next(given))


def test_sets_the_password_ends_sessions_and_lifts_the_lockout(
    db_session, dev_user, monkeypatch, capsys
) -> None:
    db_session.add(
        UserSession(
            user_id=dev_user.id,
            token="x" * 64,
            expires_at=datetime.now(timezone.utc),
        )
    )
    db_session.add(LoginAttempt(address="1.2.3.4", username=dev_user.username.lower()))
    db_session.add(LoginAttempt(address="1.2.3.4", username="somebody-else"))
    db_session.commit()

    answers(monkeypatch, STRONG, STRONG)
    assert set_admin_password.main([dev_user.username]) == 0

    db_session.refresh(dev_user)
    assert verify_password(STRONG, dev_user.password_hash)
    assert db_session.scalar(select(UserSession).where(UserSession.user_id == dev_user.id)) is None
    remaining = db_session.scalars(select(LoginAttempt)).all()
    assert [row.username for row in remaining] == ["somebody-else"]
    row = db_session.scalar(select(AuditLog).where(AuditLog.action == "account.password_set_cli"))
    assert row is not None and row.target_id == dev_user.id
    assert STRONG not in capsys.readouterr().out


def test_refuses_a_weak_password_without_changing_anything(
    db_session, dev_user, monkeypatch
) -> None:
    before = dev_user.password_hash
    answers(monkeypatch, "short")
    assert set_admin_password.main([dev_user.username]) == 1
    db_session.refresh(dev_user)
    assert dev_user.password_hash == before


def test_refuses_a_mismatched_confirmation(db_session, dev_user, monkeypatch) -> None:
    before = dev_user.password_hash
    answers(monkeypatch, STRONG, STRONG + "x")
    assert set_admin_password.main([dev_user.username]) == 1
    db_session.refresh(dev_user)
    assert dev_user.password_hash == before


def test_refuses_a_member_account(db_session, other_user, monkeypatch) -> None:
    before = other_user.password_hash
    answers(monkeypatch, STRONG, STRONG)
    assert set_admin_password.main([other_user.username]) == 1
    db_session.refresh(other_user)
    assert other_user.password_hash == before


def test_refuses_an_unknown_account_and_bad_usage(monkeypatch) -> None:
    answers(monkeypatch, STRONG, STRONG)
    assert set_admin_password.main(["nobody-here"]) == 1
    assert set_admin_password.main([]) == 2
    assert set_admin_password.main(["--help"]) == 2
