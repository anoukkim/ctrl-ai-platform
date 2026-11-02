"""privacy-and-terms: consent is required at sign-up, on both paths.

The browser disables the button, but the rule lives here: `google/complete`
(the one sign-up since signup-google-first) refuses without
`terms_accepted`, creates nothing, and claims no invite use. Accepted
sign-ups store a timezone-aware timestamp.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import InviteCode, User
from tests.conftest import SIGNUP_PASSWORD
from tests.test_google_login import google_says, make_code, start


@pytest.fixture
def development_mode():
    """The mock Google sign-in is offered in development only."""
    settings = Settings(app_env="development")
    app.dependency_overrides[get_settings] = lambda: settings
    yield
    app.dependency_overrides.pop(get_settings, None)

REFUSAL = "개인정보 처리방침과 이용약관에 동의해야 가입할 수 있습니다."


def invite_uses(db: Session) -> int:
    """Total uses across codes — each test makes exactly one code."""
    return sum(row.uses for row in db.scalars(select(InviteCode)))


def recent(accepted: datetime | None) -> bool:
    """Stored, and within the last minute.

    The column is timezone-aware; SQLite hands the value back naive, so
    the suite treats it as UTC, like every other timestamp here.
    """
    if accepted is None:
        return False
    if accepted.tzinfo is None:
        accepted = accepted.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - accepted < timedelta(minutes=1)


def test_google_signup_refuses_without_consent(
    anon_client: TestClient, db_session: Session, development_mode
) -> None:
    make_code(db_session)
    google_says(anon_client, start(anon_client), sub="g-consent", email="gc@example.com")
    before = invite_uses(db_session)

    refused = anon_client.post(
        "/api/auth/google/complete",
        json={
            "username": "gconsent",
            "display_name": "구글",
            "invite_code": "CLUB-2026",
            "password": SIGNUP_PASSWORD,
            "password_confirm": SIGNUP_PASSWORD,
        },
    )

    assert refused.status_code == 400
    assert refused.json()["detail"] == REFUSAL
    assert db_session.scalar(select(User).where(User.username == "gconsent")) is None
    # Like the password path: refusing for consent claims no invite use.
    db_session.expire_all()
    assert invite_uses(db_session) == before

    made = anon_client.post(
        "/api/auth/google/complete",
        json={
            "terms_accepted": True,
            "username": "gconsent",
            "display_name": "구글",
            "invite_code": "CLUB-2026",
            "password": SIGNUP_PASSWORD,
            "password_confirm": SIGNUP_PASSWORD,
        },
    )
    assert made.status_code == 201, made.text
    user = db_session.query(User).filter_by(username="gconsent").one()
    assert recent(user.terms_accepted_at)
    db_session.expire_all()
    assert invite_uses(db_session) == before + 1
