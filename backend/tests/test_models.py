"""Tests for the User model's defaults and constraints."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User, UserRole


def test_new_user_defaults_to_member_and_active(db_session: Session) -> None:
    user = User(email="member@ctrl.ai", display_name="Member")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    assert user.role is UserRole.MEMBER
    assert user.is_active is True


def test_audit_timestamps_are_populated(db_session: Session) -> None:
    user = User(email="stamped@ctrl.ai", display_name="Stamped")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    assert user.created_at is not None
    assert user.updated_at is not None


def test_email_must_be_unique(db_session: Session) -> None:
    db_session.add(User(email="dupe@ctrl.ai", display_name="First"))
    db_session.commit()

    db_session.add(User(email="dupe@ctrl.ai", display_name="Second"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_role_values_match_the_documented_roles() -> None:
    """Only `admin` and `member` are system roles (see CLAUDE.md section 13)."""
    assert {role.value for role in UserRole} == {"admin", "member"}


def test_database_rejects_an_unknown_role(db_session: Session) -> None:
    """The role column carries a CHECK constraint, not just Python validation.

    Raw SQL bypasses SQLAlchemy's enum check, so this proves the database
    itself refuses an invalid role.
    """
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO users (email, display_name, role, is_active) "
                "VALUES ('bad@ctrl.ai', 'Bad Role', 'superuser', 1)"
            )
        )
        db_session.commit()
