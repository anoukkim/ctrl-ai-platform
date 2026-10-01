"""Authentication and authorization.

Two separate questions are tested here:

* *Authentication* — is this request from a signed-in member at all?
* *Authorization* — is that member allowed to touch this particular row?

The second is the one that matters for a community platform: every member
is a legitimate user, so the interesting failure is one member reaching
another member's data.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD

GOOD_SIGNUP = {
    "username": "newmember",
    "email": "new@ctrl.ai",
    "password": "a-good-password",
    "display_name": "새 회원",
}


# ---------------------------------------------------------------- register


def test_register_creates_an_account_and_signs_in(anon_client: TestClient) -> None:
    response = anon_client.post("/api/auth/register", json=GOOD_SIGNUP)

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "newmember"
    assert body["display_name"] == "새 회원"
    # A new account is an ordinary member, never an admin.
    assert body["role"] == "member"
    assert body["is_admin"] is False

    # The response set a session cookie, so the client is now signed in.
    assert anon_client.get("/api/auth/me").status_code == 200


def test_register_never_returns_the_password_hash(anon_client: TestClient) -> None:
    response = anon_client.post("/api/auth/register", json=GOOD_SIGNUP)

    assert "password_hash" not in response.json()
    assert "password" not in response.json()
    # Not anywhere in the raw body either, hashed or otherwise.
    assert GOOD_SIGNUP["password"] not in response.text
    assert "argon2" not in response.text


def test_register_rejects_a_duplicate_username(anon_client: TestClient) -> None:
    anon_client.post("/api/auth/register", json=GOOD_SIGNUP)

    response = anon_client.post(
        "/api/auth/register",
        json={**GOOD_SIGNUP, "email": "different@ctrl.ai"},
    )

    assert response.status_code == 409
    assert "아이디" in response.json()["detail"]


def test_register_rejects_a_duplicate_email(anon_client: TestClient) -> None:
    anon_client.post("/api/auth/register", json=GOOD_SIGNUP)

    response = anon_client.post(
        "/api/auth/register",
        json={**GOOD_SIGNUP, "username": "differentname"},
    )

    assert response.status_code == 409
    assert "이메일" in response.json()["detail"]


def test_register_rejects_a_short_password(anon_client: TestClient) -> None:
    response = anon_client.post("/api/auth/register", json={**GOOD_SIGNUP, "password": "short"})

    assert response.status_code == 422


def test_register_rejects_a_username_with_punctuation(anon_client: TestClient) -> None:
    response = anon_client.post("/api/auth/register", json={**GOOD_SIGNUP, "username": "bad name!"})

    assert response.status_code == 422


# ------------------------------------------------------------------- login


def test_login_succeeds_with_the_right_password(anon_client: TestClient, dev_user) -> None:
    response = anon_client.post(
        "/api/auth/login",
        json={"username": dev_user.username, "password": DEV_PASSWORD},
    )

    assert response.status_code == 200
    assert response.json()["is_admin"] is True


def test_login_fails_with_the_wrong_password(anon_client: TestClient, dev_user) -> None:
    response = anon_client.post(
        "/api/auth/login",
        json={"username": dev_user.username, "password": "wrong-password"},
    )

    assert response.status_code == 401
    # Still logged out.
    assert anon_client.get("/api/auth/me").status_code == 401


def test_login_fails_for_an_unknown_user_with_the_same_message(
    anon_client: TestClient, dev_user
) -> None:
    """The message must not reveal whether the username exists."""
    wrong_password = anon_client.post(
        "/api/auth/login",
        json={"username": dev_user.username, "password": "wrong-password"},
    )
    no_such_user = anon_client.post(
        "/api/auth/login",
        json={"username": "nobody", "password": "wrong-password"},
    )

    assert wrong_password.status_code == no_such_user.status_code == 401
    assert wrong_password.json()["detail"] == no_such_user.json()["detail"]


# ------------------------------------------------------------------ logout


def test_logout_ends_the_session(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 200

    assert client.post("/api/auth/logout").status_code == 204

    assert client.get("/api/auth/me").status_code == 401


def test_logout_when_already_logged_out_is_not_an_error(anon_client: TestClient) -> None:
    assert anon_client.post("/api/auth/logout").status_code == 204


def test_a_deleted_session_stops_working_immediately(
    client: TestClient, db_session: Session
) -> None:
    """Sessions are rows, so revoking one takes effect at once."""
    from app.models import UserSession

    db_session.query(UserSession).delete()
    db_session.commit()

    assert client.get("/api/auth/me").status_code == 401


# --------------------------------------------------- logged-out is refused


def test_every_member_endpoint_refuses_a_logged_out_visitor(anon_client: TestClient) -> None:
    for method, path in [
        ("get", "/api/auth/me"),
        ("get", "/api/users"),
        ("get", "/api/builder/projects"),
        ("post", "/api/builder/projects"),
        ("get", "/api/video/projects"),
        ("get", "/api/video/models"),
        ("get", "/api/quarters/current"),
        ("get", "/api/quarters/me"),
        ("get", "/api/quarters/me/wallet"),
        ("get", "/api/quarters/me/top-ups"),
        ("get", "/api/admin/quarters"),
        ("get", "/api/admin/video-models"),
        ("get", "/api/admin/top-ups"),
    ]:
        response = getattr(anon_client, method)(path, **({"json": {}} if method == "post" else {}))
        assert response.status_code == 401, f"{method.upper()} {path} returned {response.status_code}"


def test_health_stays_public(anon_client: TestClient) -> None:
    """A health check that needs credentials is not a health check."""
    assert anon_client.get("/api/health").status_code == 200


# ------------------------------------------------- one member, one member's


def test_a_member_cannot_read_another_members_project(
    client: TestClient, anon_client: TestClient, other_user, other_participating
) -> None:
    """Answered 404, not 403: a member is not told the row exists.

    Both members participate. The second one has to, or the write attempts
    below would be refused by `require_active_member` before ownership was
    ever consulted, and the test would pass for the wrong reason.
    """
    created = client.post("/api/builder/projects", json={"name": "내 프로젝트"})
    assert created.status_code == 201
    project_id = created.json()["id"]

    # Switch this client to the other member.
    client.post("/api/auth/logout")
    signed_in = client.post(
        "/api/auth/login",
        json={"username": other_user.username, "password": MEMBER_PASSWORD},
    )
    assert signed_in.status_code == 200

    assert client.get(f"/api/builder/projects/{project_id}").status_code == 404
    assert client.patch(f"/api/builder/projects/{project_id}", json={"name": "뺏기"}).status_code == 404
    assert client.delete(f"/api/builder/projects/{project_id}").status_code == 404


def test_a_member_sees_only_their_own_projects(client: TestClient, other_user, participating) -> None:
    client.post("/api/builder/projects", json={"name": "내 프로젝트"})

    client.post("/api/auth/logout")
    client.post(
        "/api/auth/login",
        json={"username": other_user.username, "password": MEMBER_PASSWORD},
    )

    assert client.get("/api/builder/projects").json() == []


def test_a_member_sees_only_their_own_balance(
    other_client: TestClient, other_user, dev_user, db_session: Session
) -> None:
    """The wallet route is scoped to the caller; there is no id to supply.

    The other member is given money first, so reading the wrong row would
    show a non-zero balance instead of this member's empty one.
    """
    from app.services.wallet import get_or_create_balance

    rich = get_or_create_balance(db_session, dev_user.id)
    rich.balance_krw = 50_000
    db_session.commit()

    balance = other_client.get("/api/quarters/me/wallet")

    assert balance.status_code == 200
    assert balance.json()["balance_krw"] == 0
    assert balance.json()["remaining_krw"] == 0


# ------------------------------------------------------- admin is admin-only


def test_a_member_cannot_call_admin_routes(other_client: TestClient) -> None:
    for method, path, payload in [
        ("get", "/api/users", None),
        ("get", "/api/admin/quarters", None),
        ("post", "/api/admin/quarters", {}),
        ("get", "/api/admin/video-models", None),
        ("get", "/api/admin/top-ups", None),
        ("patch", "/api/admin/video-models/1", {"enabled": False}),
        ("post", "/api/admin/applications/1/review", {"approve": True}),
    ]:
        response = getattr(other_client, method)(
            path, **({"json": payload} if payload is not None else {})
        )
        assert response.status_code == 403, f"{method.upper()} {path} returned {response.status_code}"


def test_an_admin_may_call_admin_routes(client: TestClient) -> None:
    assert client.get("/api/admin/quarters").status_code == 200
    assert client.get("/api/admin/video-models").status_code == 200


# ------------------------------------------------- the hash never gets out


def test_password_hash_never_appears_in_any_response(client: TestClient) -> None:
    for path in ["/api/auth/me", "/api/users"]:
        body = client.get(path).text
        assert "password_hash" not in body
        assert "argon2" not in body
        assert "$argon2id$" not in body
