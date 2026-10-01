"""Tests for the read-only users endpoint and the dev-user seed."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.init_db import DEV_USER_EMAIL, seed_dev_user
from app.models import UserRole


def test_listing_users_requires_signing_in(anon_client: TestClient) -> None:
    """The list exposes email addresses, so a visitor may not read it."""
    response = anon_client.get("/api/users")

    assert response.status_code == 401


def test_a_member_may_not_list_users(other_client: TestClient) -> None:
    """Admin-only, enforced in the backend rather than by hiding a link."""
    response = other_client.get("/api/users")

    assert response.status_code == 403


def test_seeded_dev_user_is_returned(client: TestClient) -> None:
    """`client` is signed in as the seeded development admin."""
    response = client.get("/api/users")

    assert response.status_code == 200
    users = response.json()
    assert len(users) == 1
    assert users[0]["email"] == DEV_USER_EMAIL
    assert users[0]["username"] == "dev"
    assert users[0]["role"] == UserRole.ADMIN.value
    assert users[0]["account_status"] == "active"


def test_seed_dev_user_is_idempotent(db_session: Session) -> None:
    first = seed_dev_user(db_session)
    second = seed_dev_user(db_session)

    assert first.id == second.id


def test_user_response_contains_no_unexpected_fields(client: TestClient) -> None:
    """In particular, `password_hash` must never appear."""
    user = client.get("/api/users").json()[0]

    assert set(user) == {
        "id",
        "username",
        "email",
        "display_name",
        "role",
        "account_status",
        "created_at",
        "updated_at",
    }
    assert "password_hash" not in user
