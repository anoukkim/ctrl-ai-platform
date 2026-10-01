"""Tests for the User model's defaults and constraints."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AccountStatus, User, UserRole


def make_user(**overrides: object) -> User:
    """A valid User, so each test only states what it cares about."""
    fields: dict[str, object] = {
        "username": "member",
        "email": "member@ctrl.ai",
        "password_hash": "not-a-real-hash",
        "display_name": "Member",
    }
    fields.update(overrides)
    return User(**fields)  # type: ignore[arg-type]


def test_new_user_defaults_to_member_and_active(db_session: Session) -> None:
    user = make_user()
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    assert user.role is UserRole.MEMBER
    assert user.account_status is AccountStatus.ACTIVE
    assert user.can_sign_in is True


def test_a_non_active_account_cannot_sign_in(db_session: Session) -> None:
    """The check 1b builds on: status decides access, not a boolean."""
    for status in (AccountStatus.INACTIVE, AccountStatus.FORMER):
        user = make_user(
            username=f"user_{status.value}",
            email=f"{status.value}@ctrl.ai",
            account_status=status,
        )
        db_session.add(user)
        db_session.commit()

        assert user.can_sign_in is False


def test_audit_timestamps_are_populated(db_session: Session) -> None:
    user = make_user(username="stamped", email="stamped@ctrl.ai", display_name="Stamped")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    assert user.created_at is not None
    assert user.updated_at is not None


def test_email_must_be_unique(db_session: Session) -> None:
    db_session.add(make_user(username="first", email="dupe@ctrl.ai"))
    db_session.commit()

    db_session.add(make_user(username="second", email="dupe@ctrl.ai"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_username_must_be_unique(db_session: Session) -> None:
    db_session.add(make_user(username="taken", email="one@ctrl.ai"))
    db_session.commit()

    db_session.add(make_user(username="taken", email="two@ctrl.ai"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_role_values_match_the_documented_roles() -> None:
    """Only `admin` and `member` are system roles (see CLAUDE.md section 13)."""
    assert {role.value for role in UserRole} == {"admin", "member"}


def test_account_status_values_match_the_documented_statuses() -> None:
    """active / inactive / former — see CLAUDE.md section 10."""
    assert {status.value for status in AccountStatus} == {"active", "inactive", "former"}


def test_database_rejects_an_unknown_role(db_session: Session) -> None:
    """The role column carries a CHECK constraint, not just Python validation.

    Raw SQL bypasses SQLAlchemy's enum check, so this proves the database
    itself refuses an invalid role.
    """
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO users "
                "(username, email, password_hash, display_name, role, account_status) "
                "VALUES ('bad', 'bad@ctrl.ai', 'x', 'Bad Role', 'superuser', 'active')"
            )
        )
        db_session.commit()


def test_database_rejects_an_unknown_account_status(db_session: Session) -> None:
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO users "
                "(username, email, password_hash, display_name, role, account_status) "
                "VALUES ('bad2', 'bad2@ctrl.ai', 'x', 'Bad Status', 'member', 'banished')"
            )
        )
        db_session.commit()
