"""`python -m app.db.set_password` — the operator's password reset.

Generalised from `set_admin_password` on 2026-10-14 (owner): any account,
admin or member, by username. The password comes from a hidden prompt
(getpass, monkeypatched here), twice, at least 12 characters; the
account's sessions end, its lockout lifts, and the audit log records the
server operator — never the password. The old command name still works.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.core.security import verify_password
from app.db import set_admin_password, set_password
from app.models import AccountStatus, AuditLog, LoginAttempt, UserSession


STRONG = "correct-horse-battery-2026!"


@pytest.fixture(autouse=True)
def cli_session(db_session, monkeypatch):
    """The CLI opens its own session; point it at the test's."""
    monkeypatch.setattr(set_password, "SessionLocal", lambda: db_session)
    # The test session must survive the CLI's close().
    monkeypatch.setattr(db_session, "close", lambda: None)
    yield


def answers(monkeypatch, *values):
    given = iter(values)
    monkeypatch.setattr(set_password, "getpass", lambda prompt: next(given))


@pytest.mark.parametrize("command", [set_password, set_admin_password])
def test_resets_a_member_ends_sessions_and_lifts_the_lockout(
    db_session, other_user, monkeypatch, capsys, command
) -> None:
    db_session.add(
        UserSession(
            user_id=other_user.id,
            token="y" * 64,
            expires_at=datetime.now(timezone.utc),
        )
    )
    db_session.add(LoginAttempt(address="1.2.3.4", username=other_user.username.lower()))
    db_session.add(LoginAttempt(address="1.2.3.4", username="somebody-else"))
    db_session.commit()

    answers(monkeypatch, STRONG, STRONG)
    assert command.main([other_user.username]) == 0

    db_session.refresh(other_user)
    assert verify_password(STRONG, other_user.password_hash)
    assert (
        db_session.scalar(select(UserSession).where(UserSession.user_id == other_user.id))
        is None
    )
    remaining = db_session.scalars(select(LoginAttempt)).all()
    assert [row.username for row in remaining] == ["somebody-else"]
    row = db_session.scalar(select(AuditLog).where(AuditLog.action == "account.password_set_cli"))
    assert row is not None and row.target_id == other_user.id
    # The operator, not a signed-in admin, and never the password.
    assert row.actor_user_id is None
    assert row.detail["operator"] == "server-shell"
    assert STRONG not in str(row.detail) and STRONG not in row.summary
    assert STRONG not in capsys.readouterr().out


def test_resets_an_admin_too(db_session, dev_user, monkeypatch) -> None:
    answers(monkeypatch, STRONG, STRONG)
    assert set_password.main([dev_user.username]) == 0
    db_session.refresh(dev_user)
    assert verify_password(STRONG, dev_user.password_hash)


def test_refuses_short_and_default_passwords_without_changing_anything(
    db_session, other_user, monkeypatch, capsys
) -> None:
    before = other_user.password_hash
    for weak in ("short", "elevenchars", "devpassword"):
        answers(monkeypatch, weak)
        assert set_password.main([other_user.username]) == 1
    db_session.refresh(other_user)
    assert other_user.password_hash == before
    out = capsys.readouterr().out
    assert "12자보다 짧습니다" in out and "기본값" in out


def test_twelve_characters_is_enough(db_session, other_user, monkeypatch) -> None:
    answers(monkeypatch, "abcdefghijkl", "abcdefghijkl")
    assert set_password.main([other_user.username]) == 0


def test_refuses_a_mismatched_confirmation(db_session, other_user, monkeypatch) -> None:
    before = other_user.password_hash
    answers(monkeypatch, STRONG, STRONG + "x")
    assert set_password.main([other_user.username]) == 1
    db_session.refresh(other_user)
    assert other_user.password_hash == before


def test_refuses_a_former_member(db_session, other_user, monkeypatch) -> None:
    other_user.account_status = AccountStatus.FORMER
    db_session.commit()
    before = other_user.password_hash
    answers(monkeypatch, STRONG, STRONG)
    assert set_password.main([other_user.username]) == 1
    db_session.refresh(other_user)
    assert other_user.password_hash == before


def test_refuses_an_unknown_account_and_bad_usage(monkeypatch, capsys) -> None:
    answers(monkeypatch, STRONG, STRONG)
    assert set_password.main(["nobody-here"]) == 1
    assert set_password.main([]) == 2
    assert set_password.main(["--help"]) == 2
    assert set_admin_password.main([]) == 2
    assert "set_admin_password" in capsys.readouterr().out
