"""Tests for the read-only users endpoint and the dev-user seed."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.init_db import DEV_USER_EMAIL, seed_dev_user
from app.models import UserRole


def test_users_list_is_empty_on_a_fresh_database(client: TestClient) -> None:
    response = client.get("/api/users")

    assert response.status_code == 200
    assert response.json() == []


def test_seeded_dev_user_is_returned(client: TestClient, db_session: Session) -> None:
    seed_dev_user(db_session)

    response = client.get("/api/users")

    assert response.status_code == 200
    users = response.json()
    assert len(users) == 1
    assert users[0]["email"] == DEV_USER_EMAIL
    assert users[0]["role"] == UserRole.ADMIN.value
    assert users[0]["is_active"] is True


def test_seed_dev_user_is_idempotent(db_session: Session) -> None:
    first = seed_dev_user(db_session)
    second = seed_dev_user(db_session)

    assert first.id == second.id


def test_user_response_contains_no_unexpected_fields(
    client: TestClient, db_session: Session
) -> None:
    seed_dev_user(db_session)

    user = client.get("/api/users").json()[0]

    assert set(user) == {
        "id",
        "email",
        "display_name",
        "role",
        "is_active",
        "created_at",
        "updated_at",
    }
