"""google-login — Google로 계속하기, against the mock provider.

The real provider is not called from the suite (no network, no client);
its token handling is checked with a fake transport at the end.
"""

import urllib.parse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import AuditLog, ConnectedAccount, InviteCode, OAuthState, User, UserRole
from app.services.google_login import (
    GoogleIdentity,
    GoogleLoginError,
    MockGoogleLogin,
    RealGoogleLogin,
    challenge,
)
from tests.conftest import DEV_PASSWORD

ADMIN_EMAIL = "ctrlai.platform@gmail.com"


@pytest.fixture
def settings_for():
    def apply(**changes) -> Settings:
        values = {"app_env": "development", "admin_email": ADMIN_EMAIL, **changes}
        settings = Settings(**values)
        app.dependency_overrides[get_settings] = lambda: settings
        return settings

    yield apply
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture(autouse=True)
def development(settings_for):
    settings_for()


def start(client: TestClient, path: str = "/api/auth/google/start") -> dict[str, str]:
    """Press Google로 계속하기; return the state and challenge the mock got."""
    response = client.get(path, follow_redirects=False)
    assert response.status_code == 302, response.text
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(response.headers["location"]).query))
    assert "ctrlai_oauth_state" in response.headers.get("set-cookie", "")
    return query


def google_says(client: TestClient, query: dict[str, str], *, sub="g-111", email="new@example.com",
                verified=True, name="새 회원", state=None):
    code = MockGoogleLogin.make_code(
        GoogleIdentity(sub=sub, email=email, email_verified=verified, name=name),
        query["code_challenge"],
    )
    return client.get(
        "/api/auth/google/callback",
        params={"code": code, "state": state or query["state"]},
        follow_redirects=False,
    )


def make_code(db: Session, code: str = "CLUB-2026") -> InviteCode:
    invite = InviteCode(code=code, max_uses=10, is_active=True)
    db.add(invite)
    db.commit()
    return invite


# ------------------------------------------------------------- state and PKCE


def test_start_redirects_with_state_and_s256_challenge(anon_client: TestClient, db_session: Session) -> None:
    query = start(anon_client)
    row = db_session.get(OAuthState, query["state"])
    assert row is not None and row.purpose == "signin"
    assert query["code_challenge"] == challenge(row.code_verifier)


def test_state_is_single_use(anon_client: TestClient) -> None:
    query = start(anon_client)
    first = google_says(anon_client, query)
    assert first.headers["location"].startswith("/signup/google")
    again = google_says(anon_client, query)
    assert "google=expired" in again.headers["location"]


def test_a_state_from_another_browser_is_refused(anon_client: TestClient) -> None:
    query = start(anon_client)
    anon_client.cookies.clear()  # the callback arrives without our cookie
    response = google_says(anon_client, query)
    assert "google=expired" in response.headers["location"]


def test_a_wrong_pkce_verifier_is_refused() -> None:
    code = MockGoogleLogin.make_code(
        GoogleIdentity(sub="s", email="e@example.com", email_verified=True, name=""), challenge("right")
    )
    with pytest.raises(GoogleLoginError):
        MockGoogleLogin().exchange(code, "wrong")


def test_cancelling_at_google_signs_nobody_in(anon_client: TestClient) -> None:
    query = start(anon_client)
    response = anon_client.get(
        "/api/auth/google/callback", params={"error": "access_denied", "state": query["state"]},
        follow_redirects=False,
    )
    assert "google=cancelled" in response.headers["location"]
    assert anon_client.get("/api/auth/me").status_code == 401


# ------------------------------------------------------------- sign-up


def test_a_new_google_account_goes_to_setup_and_needs_an_invite_code(
    anon_client: TestClient, db_session: Session
) -> None:
    make_code(db_session)
    google_says(anon_client, start(anon_client))

    pending = anon_client.get("/api/auth/google/pending").json()
    assert pending["email"] == "new@example.com"
    assert pending["needs_invite_code"] is True

    refused = anon_client.post(
        "/api/auth/google/complete", json={"username": "newbie", "display_name": "새 회원"}
    )
    assert refused.status_code == 400
    assert refused.json()["detail"] == "초대 코드가 필요합니다."

    made = anon_client.post(
        "/api/auth/google/complete",
        json={"username": "newbie", "display_name": "새 회원", "invite_code": "club-2026"},
    )
    assert made.status_code == 201, made.text
    me = anon_client.get("/api/auth/me").json()
    assert me["username"] == "newbie" and me["role"] == "member"

    member = db_session.query(User).filter_by(username="newbie").one()
    assert member.password_hash == "!"  # no usable password
    link = db_session.query(ConnectedAccount).filter_by(user_id=member.id).one()
    assert link.provider_account_id == "g-111"


def test_a_code_is_required_in_the_beta_too(
    anon_client: TestClient, db_session: Session, settings_for, monkeypatch
) -> None:
    """In the beta (with real Google configured) the setup screen still asks
    for a code. Real Google cannot be called here, so the mock stands in."""
    from app.api.routes import google_auth

    settings_for(app_env="beta")
    monkeypatch.setattr(google_auth, "get_google_login", lambda settings: MockGoogleLogin())
    make_code(db_session)
    google_says(anon_client, start(anon_client))

    assert anon_client.get("/api/auth/google/pending").json()["needs_invite_code"] is True
    refused = anon_client.post(
        "/api/auth/google/complete", json={"username": "betauser", "display_name": "x"}
    )
    assert refused.status_code == 400
    made = anon_client.post(
        "/api/auth/google/complete",
        json={"username": "betauser", "display_name": "x", "invite_code": "CLUB-2026"},
    )
    assert made.status_code == 201


def test_the_same_sub_signs_in_next_time(anon_client: TestClient, db_session: Session) -> None:
    make_code(db_session)
    google_says(anon_client, start(anon_client))
    anon_client.post(
        "/api/auth/google/complete",
        json={"username": "newbie", "display_name": "새 회원", "invite_code": "CLUB-2026"},
    )
    anon_client.post("/api/auth/logout")
    anon_client.cookies.clear()

    # The email at Google changed; the sub did not. Still the same account.
    response = google_says(anon_client, start(anon_client), email="renamed@example.com")
    assert response.headers["location"] == "/"
    assert anon_client.get("/api/auth/me").json()["username"] == "newbie"


def test_an_existing_account_is_never_entered_by_email(
    anon_client: TestClient, db_session: Session, other_user
) -> None:
    """`other_user` has the email other@ctrl.ai and a password account."""
    make_code(db_session)
    response = google_says(anon_client, start(anon_client), sub="g-999", email="other@ctrl.ai")

    assert response.headers["location"].startswith("/signup/google")
    assert anon_client.get("/api/auth/me").status_code == 401
    assert anon_client.get("/api/auth/google/pending").json()["email_taken"] is True
    refused = anon_client.post(
        "/api/auth/google/complete",
        json={"username": "copycat", "display_name": "x", "invite_code": "CLUB-2026"},
    )
    assert refused.status_code == 409
    assert "Profile에서 Google을 연결" in refused.json()["detail"]


def test_only_a_verified_admin_email_becomes_admin(anon_client: TestClient, db_session: Session) -> None:
    """Unverified: refused outright — an unconfirmed address could be
    someone else's, and taking it would lock its owner out."""
    make_code(db_session)
    google_says(anon_client, start(anon_client), sub="g-unverified", email=ADMIN_EMAIL, verified=False)
    pending = anon_client.get("/api/auth/google/pending").json()
    assert pending["email_verified"] is False
    refused = anon_client.post(
        "/api/auth/google/complete",
        json={"username": "notadmin", "display_name": "x", "invite_code": "CLUB-2026"},
    )
    assert refused.status_code == 400
    assert "이메일 확인" in refused.json()["detail"]
    assert db_session.query(User).filter_by(username="notadmin").count() == 0


def test_the_verified_admin_email_becomes_admin_without_a_code(
    anon_client: TestClient, db_session: Session
) -> None:
    google_says(anon_client, start(anon_client), sub="g-owner", email=ADMIN_EMAIL.upper())
    made = anon_client.post(
        "/api/auth/google/complete", json={"username": "owner", "display_name": "운영자"}
    )
    assert made.status_code == 201, made.text
    assert made.json()["role"] == "admin"
    assert db_session.query(AuditLog).filter_by(action="account.admin_by_google").count() == 1


# ------------------------------------------------------------- linking


def test_a_signed_in_member_links_google_from_profile(client: TestClient, db_session: Session, dev_user) -> None:
    query = start(client, "/api/account/google/link/start")
    response = google_says(client, query, sub="g-dev", email="dev-google@example.com")
    assert response.headers["location"] == "/profile?google=linked"
    status = client.get("/api/account/google").json()
    assert status == {"available": True, "linked": True, "email": "dev-google@example.com"}

    # Signing in with that Google account now opens the dev account.
    client.post("/api/auth/logout")
    client.cookies.clear()
    signed = google_says(client, start(client), sub="g-dev", email="dev-google@example.com")
    assert signed.headers["location"] == "/"
    assert client.get("/api/auth/me").json()["username"] == dev_user.username


def test_a_google_account_linked_elsewhere_is_refused(
    anon_client: TestClient, db_session: Session, dev_user, other_user
) -> None:
    db_session.add(ConnectedAccount(user_id=other_user.id, provider="google", provider_account_id="g-shared", email="x@example.com"))
    db_session.commit()
    anon_client.post("/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD})

    response = google_says(anon_client, start(anon_client, "/api/account/google/link/start"), sub="g-shared")

    assert response.headers["location"] == "/profile?google=taken"
    assert db_session.query(ConnectedAccount).filter_by(user_id=dev_user.id).count() == 0


def test_linking_needs_a_signed_in_member(anon_client: TestClient) -> None:
    assert anon_client.get("/api/account/google/link/start", follow_redirects=False).status_code == 401


# ------------------------------------------------------------- where it is offered


def test_the_mock_is_not_offered_outside_development(anon_client: TestClient, settings_for) -> None:
    settings_for(app_env="beta")
    assert anon_client.get("/api/auth/google/start", follow_redirects=False).status_code == 404
    assert anon_client.get("/api/auth/google/mock-consent").status_code == 404
    assert anon_client.get("/api/auth/google/callback").status_code == 404
    assert anon_client.get("/api/site").json()["google_login"] is False


def test_site_says_google_is_offered_in_development(anon_client: TestClient) -> None:
    assert anon_client.get("/api/site").json()["google_login"] is True


def test_real_google_needs_its_settings() -> None:
    problems = Settings(app_env="development", google_login_provider="google").startup_problems()
    assert any("GOOGLE_CLIENT_ID" in p for p in problems)


def test_no_route_returns_a_google_token(anon_client: TestClient, db_session: Session) -> None:
    make_code(db_session)
    response = google_says(anon_client, start(anon_client))
    body = response.text + str(response.headers)
    assert "id_token" not in body and "access_token" not in body


# ------------------------------------------------------------- real provider, faked transport


def _jwt(claims: dict) -> str:
    import base64
    import json

    def b64(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()

    return f"{b64({'alg': 'RS256'})}.{b64(claims)}.signature"


def test_real_provider_checks_issuer_audience_and_expiry() -> None:
    import time

    settings = Settings(google_client_id="club-client", google_client_secret="s", google_redirect_uri="https://ctrlai.my/api/auth/google/callback")
    good = {"iss": "https://accounts.google.com", "aud": "club-client", "exp": time.time() + 600,
            "sub": "123", "email": "a@example.com", "email_verified": True, "name": "A"}
    seen = {}

    def transport(url, form):
        seen.update(form)
        return {"id_token": _jwt(good), "access_token": "never-stored"}

    identity = RealGoogleLogin(settings, transport=transport).exchange("code", "verifier")
    assert identity == GoogleIdentity(sub="123", email="a@example.com", email_verified=True, name="A")
    assert seen["code_verifier"] == "verifier" and seen["grant_type"] == "authorization_code"

    for wrong in ({"aud": "someone-else"}, {"iss": "https://evil.example"}, {"exp": time.time() - 1}):
        with pytest.raises(GoogleLoginError):
            RealGoogleLogin(settings, transport=lambda u, f, w=wrong: {"id_token": _jwt({**good, **w})}).exchange("c", "v")


def test_real_provider_asks_only_for_sign_in_scopes() -> None:
    settings = Settings(google_client_id="club-client", google_redirect_uri="https://ctrlai.my/api/auth/google/callback")
    url = RealGoogleLogin(settings).authorization_url("st", "ch")
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
    assert query["scope"] == "openid email profile"
    assert query["code_challenge_method"] == "S256"
    assert "youtube" not in url


# ------------------------------------------------------------- review round 1


def test_an_email_taken_in_another_case_is_still_taken(
    anon_client: TestClient, db_session: Session, other_user
) -> None:
    make_code(db_session)
    google_says(anon_client, start(anon_client), sub="g-case", email="OTHER@ctrl.ai")
    assert anon_client.get("/api/auth/google/pending").json()["email_taken"] is True


def test_linking_needs_the_same_member_still_signed_in(
    client: TestClient, db_session: Session, dev_user
) -> None:
    query = start(client, "/api/account/google/link/start")
    client.post("/api/auth/logout")  # walked away; someone else at the chooser
    response = google_says(client, query, sub="g-intruder")
    assert response.headers["location"] == "/profile?google=failed"
    assert db_session.query(ConnectedAccount).count() == 0


def test_linking_is_audited(client: TestClient, db_session: Session) -> None:
    google_says(client, start(client, "/api/account/google/link/start"), sub="g-dev")
    assert db_session.query(AuditLog).filter_by(action="account.google_linked").count() == 1


def test_password_sign_in_is_rate_limited(
    anon_client: TestClient, dev_user, settings_for
) -> None:
    settings_for(login_failures_per_15_minutes=3)
    for _ in range(3):
        wrong = anon_client.post("/api/auth/login", json={"username": dev_user.username, "password": "nope"})
        assert wrong.status_code == 401
    blocked = anon_client.post(
        "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
    )
    assert blocked.status_code == 429


def test_a_google_only_member_withdraws_by_typing_the_username(
    anon_client: TestClient, db_session: Session
) -> None:
    make_code(db_session)
    google_says(anon_client, start(anon_client))
    anon_client.post(
        "/api/auth/google/complete",
        json={"username": "leaver", "display_name": "x", "invite_code": "CLUB-2026"},
    )
    assert anon_client.get("/api/auth/me").json()["has_password"] is False

    wrong = anon_client.post("/api/account/withdrawal", json={"confirm_username": "someone"})
    assert wrong.status_code == 400
    done = anon_client.post("/api/account/withdrawal", json={"confirm_username": "leaver"})
    assert done.status_code == 200, done.text


def test_anonymising_drops_the_google_link(db_session: Session, other_user) -> None:
    from datetime import datetime, timedelta, timezone

    from app.services import withdrawal

    db_session.add(ConnectedAccount(user_id=other_user.id, provider="google", provider_account_id="g-gone", email="x@example.com"))
    db_session.commit()
    row = withdrawal.withdraw(db_session, member=other_user, actor=other_user)
    db_session.commit()
    withdrawal.anonymise(db_session, row, now=datetime.now(timezone.utc) + timedelta(days=31))
    db_session.commit()
    assert db_session.query(ConnectedAccount).filter_by(user_id=other_user.id).count() == 0


def test_a_broken_answer_from_google_is_a_failed_sign_in_not_a_500() -> None:
    import time

    settings = Settings(google_client_id="club-client", google_client_secret="s", google_redirect_uri="https://ctrlai.my/api/auth/google/callback")
    good = {"iss": "https://accounts.google.com", "aud": "club-client", "exp": time.time() + 600,
            "sub": "1", "email": "a@example.com", "email_verified": True}
    for answer in (
        {"id_token": "not-a-jwt"},
        {"id_token": _jwt({**good, "exp": "soon"})},
        {"id_token": _jwt({**good, "aud": ["club-client", "other"], "azp": "other"})},
    ):
        with pytest.raises(GoogleLoginError):
            RealGoogleLogin(settings, transport=lambda u, f, a=answer: a).exchange("c", "v")
    import base64
    import json

    payload = base64.urlsafe_b64encode(json.dumps([1, 2]).encode()).rstrip(b"=").decode()
    with pytest.raises(GoogleLoginError):
        RealGoogleLogin(settings, transport=lambda u, f: {"id_token": f"h.{payload}.s"}).exchange("c", "v")
