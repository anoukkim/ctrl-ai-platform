"""signup-google-first (owner, 2026-11-03) — 비밀번호를 잊었어요 and the notice.

Sign-up being Google-only and the setup screen's password are covered in
`test_auth.py` (the setup route) and `test_invites.py` (the code rules on
that route). Here: the password reset a fresh Google sign-in grants, and
the `has_google` flag the app's "로그인 방법을 하나 더" notice reads.

The grant is a row: ten minutes, single use, spent atomically. No session
exists until the new password is saved — then this browser is signed in
and every other one is signed out.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.main import app
from app.models import AuditLog, PasswordResetGrant, User, UserSession
from app.models.audit import AuditAction
from tests.conftest import JSON_HEADERS, SIGNUP_PASSWORD, google_signup
from tests.test_google_login import google_says, settings_for, start  # noqa: F401

NEW_PASSWORD = "a-brand-new-password"
PW = {"password": NEW_PASSWORD, "password_confirm": NEW_PASSWORD}


@pytest.fixture(autouse=True)
def development(settings_for):  # noqa: F811
    settings_for()


@pytest.fixture
def member(anon_client: TestClient, invite_code) -> str:
    """A member made the only way there is, signed out again. Returns the sub."""
    made = google_signup(anon_client, username="forgetful", sub="g-forgetful")
    assert made.status_code == 201, made.text
    anon_client.post("/api/auth/logout")
    anon_client.cookies.clear()
    return "g-forgetful"


def forgot(client: TestClient, *, sub: str = "g-forgetful"):
    """Press 비밀번호를 잊었어요 and come back from Google as `sub`."""
    query = start(client, "/api/auth/google/reset/start")
    return google_says(client, query, sub=sub, email="whatever@example.com")


def grants(db: Session) -> list[PasswordResetGrant]:
    return list(db.scalars(select(PasswordResetGrant)))


# ------------------------------------------------------------- the happy path


def test_a_google_sign_in_lets_the_member_set_a_new_password_once(
    anon_client: TestClient, db_session: Session, member: str
) -> None:
    # A browser elsewhere, signed in with the old password.
    elsewhere = TestClient(app, headers=JSON_HEADERS)
    assert elsewhere.post(
        "/api/auth/login", json={"username": "forgetful", "password": SIGNUP_PASSWORD}
    ).status_code == 200

    back = forgot(anon_client)
    assert back.headers["location"] == "/login/reset"
    assert "ctrlai_password_reset" in back.headers.get("set-cookie", "")
    # No session yet: proving the Google account is not signing in.
    assert anon_client.get("/api/auth/me").status_code == 401

    pending = anon_client.get("/api/auth/google/reset/pending")
    assert pending.status_code == 200, pending.text
    assert pending.json()["username"] == "forgetful"
    assert 0 < pending.json()["seconds_left"] <= 600

    done = anon_client.post("/api/auth/google/reset/complete", json=PW)
    assert done.status_code == 200, done.text
    assert done.json()["username"] == "forgetful"
    assert "password_hash" not in done.text and "argon2" not in done.text
    # Signed in here …
    assert anon_client.get("/api/auth/me").status_code == 200
    # … and nowhere else.
    assert elsewhere.get("/api/auth/me").status_code == 401

    stored = db_session.scalar(select(User).where(User.username == "forgetful"))
    assert verify_password(NEW_PASSWORD, stored.password_hash)
    assert not verify_password(SIGNUP_PASSWORD, stored.password_hash)
    (grant,) = grants(db_session)
    assert grant.used_at is not None
    assert db_session.query(AuditLog).filter_by(action=AuditAction.PASSWORD_RESET_BY_GOOGLE).count() == 1

    # The new password signs in; the grant is spent.
    anon_client.post("/api/auth/logout")
    assert anon_client.post(
        "/api/auth/login", json={"username": "forgetful", "password": NEW_PASSWORD}
    ).status_code == 200
    again = anon_client.post("/api/auth/google/reset/complete", json={"password": "yet-another-one", "password_confirm": "yet-another-one"})
    assert again.status_code == 400
    assert verify_password(NEW_PASSWORD, db_session.scalar(select(User).where(User.username == "forgetful")).password_hash)


def test_the_grant_is_single_use_even_with_the_cookie_kept(
    anon_client: TestClient, db_session: Session, member: str
) -> None:
    forgot(anon_client)
    cookie = anon_client.cookies.get("ctrlai_password_reset")
    assert anon_client.post("/api/auth/google/reset/complete", json=PW).status_code == 200

    # A copy of the cookie, after the first use.
    copy = TestClient(app, headers=JSON_HEADERS)
    copy.cookies.set("ctrlai_password_reset", cookie)
    assert copy.get("/api/auth/google/reset/pending").status_code == 404
    refused = copy.post("/api/auth/google/reset/complete", json={"password": "stolen-later-1", "password_confirm": "stolen-later-1"})
    assert refused.status_code == 400
    assert "시간이 지났어요" in refused.json()["detail"]
    assert copy.get("/api/auth/me").status_code == 401


def test_the_grant_expires_after_ten_minutes(
    anon_client: TestClient, db_session: Session, member: str
) -> None:
    forgot(anon_client)
    (grant,) = grants(db_session)
    assert grant.used_at is None
    grant.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    assert anon_client.get("/api/auth/google/reset/pending").status_code == 404
    refused = anon_client.post("/api/auth/google/reset/complete", json=PW)
    assert refused.status_code == 400
    stored = db_session.scalar(select(User).where(User.username == "forgetful"))
    assert verify_password(SIGNUP_PASSWORD, stored.password_hash), "the old password stands"

    # Starting again makes a fresh grant and prunes the dead one.
    forgot(anon_client)
    assert len(grants(db_session)) == 1
    assert anon_client.post("/api/auth/google/reset/complete", json=PW).status_code == 200


# ------------------------------------------------------------- refusals


@pytest.mark.parametrize(
    ("password", "confirm", "word"),
    [("short", "short", "8자"), (NEW_PASSWORD, NEW_PASSWORD + "!", "달라요"), ("", "", "8자")],
)
def test_the_new_password_follows_the_rules_and_a_bad_try_keeps_the_grant(
    anon_client: TestClient, db_session: Session, member: str, password: str, confirm: str, word: str
) -> None:
    forgot(anon_client)
    refused = anon_client.post(
        "/api/auth/google/reset/complete", json={"password": password, "password_confirm": confirm}
    )
    assert refused.status_code == 400
    assert word in refused.json()["detail"]
    (grant,) = grants(db_session)
    assert grant.used_at is None, "a typo does not spend the ten minutes"
    assert anon_client.post("/api/auth/google/reset/complete", json=PW).status_code == 200


def test_a_google_account_nobody_linked_cannot_reset_anything(
    anon_client: TestClient, db_session: Session, member: str
) -> None:
    back = forgot(anon_client, sub="g-stranger")
    assert "google=reset_unknown" in back.headers["location"]
    assert back.headers["location"].startswith("/login")
    assert grants(db_session) == []
    assert anon_client.get("/api/auth/google/reset/pending").status_code == 404
    assert anon_client.get("/api/auth/me").status_code == 401


def test_a_blocked_member_gets_no_grant(
    anon_client: TestClient, db_session: Session, member: str
) -> None:
    from app.models import AccountStatus

    stored = db_session.scalar(select(User).where(User.username == "forgetful"))
    stored.account_status = AccountStatus.INACTIVE
    db_session.commit()

    back = forgot(anon_client)
    assert "google=blocked" in back.headers["location"]
    assert grants(db_session) == []


def test_without_a_cookie_there_is_nothing_to_reset(anon_client: TestClient) -> None:
    assert anon_client.get("/api/auth/google/reset/pending").status_code == 404
    refused = anon_client.post("/api/auth/google/reset/complete", json={"password": "x", "password_confirm": "y"})
    assert refused.status_code == 400
    # Not "시간이 지났어요" (there never was a grant), and not the password
    # rule either: without a grant the rules are not even looked at.
    assert "상태가 아니에요" in refused.json()["detail"]


def test_a_password_changed_meanwhile_voids_the_grant(
    anon_client: TestClient, db_session: Session, member: str
) -> None:
    """Profile › 비밀번호 바꾸기 (or an admin reset) while a 비밀번호를 잊었어요
    is open: the earlier grant must not still set a third password."""
    forgot(anon_client)
    elsewhere = TestClient(app, headers=JSON_HEADERS)
    elsewhere.post("/api/auth/login", json={"username": "forgetful", "password": SIGNUP_PASSWORD})
    changed = elsewhere.put(
        "/api/account/password",
        json={"current_password": SIGNUP_PASSWORD, "new_password": "changed-on-profile"},
    )
    assert changed.status_code == 200, changed.text

    assert grants(db_session) == []
    assert anon_client.post("/api/auth/google/reset/complete", json=PW).status_code == 400
    stored = db_session.scalar(select(User).where(User.username == "forgetful"))
    assert verify_password("changed-on-profile", stored.password_hash)


def test_where_google_sign_in_is_off_the_reset_does_not_exist(
    anon_client: TestClient, settings_for  # noqa: F811
) -> None:
    settings_for(google_login_provider="off")
    assert anon_client.get("/api/auth/google/reset/start", follow_redirects=False).status_code == 404
    assert anon_client.get("/api/auth/google/reset/pending").status_code == 404
    assert anon_client.post("/api/auth/google/reset/complete", json=PW).status_code == 404


# ------------------------------------------------------------- the notice flag


def test_me_says_which_sign_in_methods_exist(
    anon_client: TestClient, db_session: Session, invite_code, client: TestClient
) -> None:
    """The dev admin from the seed has a password and no Google: the app
    shows the notice to admins too. A new member has both."""
    me = client.get("/api/auth/me").json()
    assert (me["has_password"], me["has_google"]) == (True, False)

    other = TestClient(app, headers=JSON_HEADERS)
    made = google_signup(other, username="complete", sub="g-complete")
    assert (made.json()["has_password"], made.json()["has_google"]) == (True, True)
    me = other.get("/api/auth/me").json()
    assert (me["has_password"], me["has_google"]) == (True, True)

    # Remove the password: the flag follows.
    assert other.post("/api/account/password/remove", json={"current_password": SIGNUP_PASSWORD}).status_code == 200
    me = other.get("/api/auth/me").json()
    assert (me["has_password"], me["has_google"]) == (False, True)


def test_sessions_of_a_reset_member_are_rows_that_the_reset_deletes(
    anon_client: TestClient, db_session: Session, member: str
) -> None:
    elsewhere = TestClient(app, headers=JSON_HEADERS)
    elsewhere.post("/api/auth/login", json={"username": "forgetful", "password": SIGNUP_PASSWORD})
    user_id = db_session.scalar(select(User.id).where(User.username == "forgetful"))
    assert db_session.query(UserSession).filter_by(user_id=user_id).count() == 1

    forgot(anon_client)
    anon_client.post("/api/auth/google/reset/complete", json=PW)
    rows = db_session.query(UserSession).filter_by(user_id=user_id).all()
    assert len(rows) == 1 and rows[0].token == anon_client.cookies.get("ctrlai_session")
