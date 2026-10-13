"""privacy-and-terms: consent is required at sign-up, on both paths.

The browser disables the button, but the rule lives here: `register` and
`google/complete` refuse without `terms_accepted`, create nothing, and
claim no invite use. Accepted sign-ups store a timezone-aware timestamp.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import InviteCode, User
from tests.conftest import INVITE_CODE
from tests.test_google_login import google_says, make_code, start


@pytest.fixture
def development_mode():
    """The mock Google sign-in is offered in development only."""
    settings = Settings(app_env="development")
    app.dependency_overrides[get_settings] = lambda: settings
    yield
    app.dependency_overrides.pop(get_settings, None)

SIGNUP = {
    "username": "consenting",
    "email": "consenting@ctrl.ai",
    "password": "a-good-password",
    "display_name": "동의한 회원",
    "invite_code": INVITE_CODE,
}

REFUSAL = "개인정보 처리방침과 이용약관에 동의해야 가입할 수 있습니다."


def invite_uses(db: Session) -> int:
    row = db.scalar(select(InviteCode))
    return row.uses if row else 0


def test_register_refuses_without_consent_and_spends_nothing(
    anon_client: TestClient, db_session: Session, invite_code
) -> None:
    before = invite_uses(db_session)

    missing = anon_client.post("/api/auth/register", json=SIGNUP)
    explicit = anon_client.post(
        "/api/auth/register", json={**SIGNUP, "terms_accepted": False}
    )

    assert missing.status_code == 400
    assert missing.json()["detail"] == REFUSAL
    assert explicit.status_code == 400
    assert db_session.scalar(select(User).where(User.username == "consenting")) is None
    # The code was not consumed and the attempt was not counted as a code
    # failure — the member just has to tick the box.
    assert invite_uses(db_session) == before


def test_register_stores_when_consent_was_given(
    anon_client: TestClient, db_session: Session, invite_code
) -> None:
    made = anon_client.post("/api/auth/register", json={**SIGNUP, "terms_accepted": True})

    assert made.status_code == 201, made.text
    user = db_session.query(User).filter_by(username="consenting").one()
    assert user.terms_accepted_at is not None
    # The column is timezone-aware; SQLite hands the value back naive, so
    # the suite treats it as UTC, like every other timestamp here.
    accepted = user.terms_accepted_at
    if accepted.tzinfo is None:
        accepted = accepted.replace(tzinfo=timezone.utc)
    assert datetime.now(timezone.utc) - accepted < timedelta(minutes=1)


def test_google_signup_refuses_without_consent(
    anon_client: TestClient, db_session: Session, development_mode
) -> None:
    make_code(db_session)
    google_says(anon_client, start(anon_client), sub="g-consent", email="gc@example.com")

    refused = anon_client.post(
        "/api/auth/google/complete",
        json={"username": "gconsent", "display_name": "구글", "invite_code": "CLUB-2026"},
    )

    assert refused.status_code == 400
    assert refused.json()["detail"] == REFUSAL
    assert db_session.scalar(select(User).where(User.username == "gconsent")) is None

    made = anon_client.post(
        "/api/auth/google/complete",
        json={
            "terms_accepted": True,
            "username": "gconsent",
            "display_name": "구글",
            "invite_code": "CLUB-2026",
        },
    )
    assert made.status_code == 201, made.text
    user = db_session.query(User).filter_by(username="gconsent").one()
    assert user.terms_accepted_at is not None
