"""invite-only-signup — codes, the signup rules, limits, and the admin side."""

import threading
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import AuditLog, InviteCode, User
from app.services import invites, rate_limit
from tests.conftest import DEV_PASSWORD

SIGNUP = {
    "username": "invited",
    "email": "invited@ctrl.ai",
    "password": "a-good-password",
    "display_name": "초대받은 회원",
    "terms_accepted": True,
}


def make_code(db: Session, code: str = "CLUB-2026", **fields) -> InviteCode:
    invite = InviteCode(code=code, max_uses=fields.pop("max_uses", 5), **fields)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


def signup(client: TestClient, code: str | None, **changes):
    body = {**SIGNUP, **changes}
    if code is not None:
        body["invite_code"] = code
    return client.post("/api/auth/register", json=body)


def users(db: Session) -> int:
    return db.query(User).count()


@pytest.fixture
def settings_override():
    """Apply a changed Settings for the duration of one test."""

    def apply(**changes) -> Settings:
        changed = Settings(app_env="development", **changes)
        app.dependency_overrides[get_settings] = lambda: changed
        return changed

    yield apply
    app.dependency_overrides.pop(get_settings, None)


# ------------------------------------------------------------- signing up


def test_a_valid_code_creates_the_account_and_takes_one_use(
    anon_client: TestClient, db_session: Session
) -> None:
    invite = make_code(db_session)

    # Case-insensitive and trimmed.
    response = signup(anon_client, "  club-2026 ")

    assert response.status_code == 201, response.text
    db_session.refresh(invite)
    assert invite.uses == 1
    member = db_session.query(User).filter_by(username="invited").one()
    assert member.invite_code_id == invite.id
    # Usable at once: signed in, no approval step.
    assert anon_client.get("/api/auth/me").json()["username"] == "invited"


def test_a_new_account_still_has_to_apply_for_a_quarter(
    anon_client: TestClient, db_session: Session
) -> None:
    make_code(db_session)
    signup(anon_client, "CLUB-2026")
    # Creating anything is participation-gated; a fresh account is not participating.
    assert anon_client.post("/api/chat/conversations", json={}).status_code == 403


def test_signing_up_without_a_code_is_refused(
    anon_client: TestClient, db_session: Session
) -> None:
    before = users(db_session)
    for code in (None, "", "   "):
        response = signup(anon_client, code)
        assert response.status_code == 400
        assert response.json()["detail"] == invites.CODE_REQUIRED
    assert users(db_session) == before


@pytest.mark.parametrize("state", ["unknown", "expired", "exhausted", "deactivated"])
def test_every_unusable_code_gets_the_same_message(
    anon_client: TestClient, db_session: Session, state: str
) -> None:
    """Expired, used up, switched off or never existed: one message, so the
    form does not tell a guesser which codes exist."""
    past = datetime.now(timezone.utc) - timedelta(days=1)
    fields = {
        "unknown": None,
        "expired": {"expires_at": past},
        "exhausted": {"max_uses": 2, "uses": 2},
        "deactivated": {"is_active": False},
    }[state]
    if fields is not None:
        invite = make_code(db_session, **fields)
        uses_before = invite.uses
    before = users(db_session)

    response = signup(anon_client, "CLUB-2026")

    assert response.status_code == 400
    assert response.json()["detail"] == invites.CODE_UNUSABLE
    assert users(db_session) == before
    if fields is not None:
        db_session.refresh(invite)
        assert invite.uses == uses_before


def test_a_single_use_code_works_once(anon_client: TestClient, db_session: Session) -> None:
    make_code(db_session, "ONCE-ONLY", max_uses=1)
    assert signup(anon_client, "ONCE-ONLY").status_code == 201
    second = signup(anon_client, "ONCE-ONLY", username="second", email="second@ctrl.ai")
    assert second.status_code == 400
    assert second.json()["detail"] == invites.CODE_UNUSABLE


def test_a_taken_username_does_not_use_up_the_code(
    anon_client: TestClient, db_session: Session, other_user
) -> None:
    invite = make_code(db_session)
    response = signup(anon_client, "CLUB-2026", username=other_user.username)
    assert response.status_code == 409
    db_session.refresh(invite)
    assert invite.uses == 0


def test_the_code_is_checked_before_the_username(
    anon_client: TestClient, db_session: Session, other_user
) -> None:
    """Without a usable code nobody learns which usernames are taken."""
    response = signup(anon_client, "NOPE-0000", username=other_user.username)
    assert response.status_code == 400
    assert response.json()["detail"] == invites.CODE_UNUSABLE


def test_the_prefilled_link_code_is_the_one_that_counts(
    anon_client: TestClient, db_session: Session
) -> None:
    """/signup?code=… only fills the field; the request carries the code."""
    make_code(db_session, "LINK-CODE-1")
    assert signup(anon_client, "link-code-1").status_code == 201


def test_existing_accounts_are_unaffected(anon_client: TestClient, dev_user) -> None:
    assert dev_user.invite_code_id is None
    response = anon_client.post(
        "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
    )
    assert response.status_code == 200


def test_a_deactivated_code_leaves_its_accounts_alone(
    client: TestClient, db_session: Session
) -> None:
    invite = make_code(db_session)
    other = TestClient(app)
    assert signup(other, "CLUB-2026").status_code == 201
    assert client.post(f"/api/admin/invites/{invite.id}/deactivate").status_code == 200

    again = TestClient(app)
    login = again.post(
        "/api/auth/login", json={"username": SIGNUP["username"], "password": SIGNUP["password"]}
    )
    assert login.status_code == 200, "an account made with the code still signs in"
    third = signup(again, "CLUB-2026", username="late", email="late@ctrl.ai")
    assert third.json()["detail"] == invites.CODE_UNUSABLE


# ------------------------------------------------------------- the last use


def test_claim_refuses_once_the_code_is_used_up(db_session: Session) -> None:
    invite = make_code(db_session, max_uses=1)
    assert invites.claim(db_session, invite.id) is True
    db_session.commit()
    assert invites.claim(db_session, invite.id) is False


def test_the_last_use_cannot_be_taken_twice_at_once(pg_engine) -> None:
    """Eight threads race for a single-use code on real PostgreSQL.

    Exactly one may win. Runs on the PostgreSQL test database and skips
    without one, like the budget lock test it is modelled on.
    """
    from sqlalchemy.orm import sessionmaker

    # The PostgreSQL test database (tests/pg.py); skips without one.
    Session_ = sessionmaker(bind=pg_engine, expire_on_commit=False)
    code = f"RACE-{uuid.uuid4().hex[:8].upper()}"
    with Session_() as setup:
        invite = InviteCode(code=code, max_uses=1, is_active=True)
        setup.add(invite)
        setup.commit()
        invite_id = invite.id

    results: list[bool] = []
    lock = threading.Lock()
    start = threading.Barrier(8)

    def attempt() -> None:
        with Session_() as session:
            start.wait()
            won = invites.claim(session, invite_id)
            session.commit()
        with lock:
            results.append(won)

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    try:
        with Session_() as check:
            assert check.get(InviteCode, invite_id).uses == 1
        assert results.count(True) == 1
        assert results.count(False) == 7
    finally:
        with Session_() as cleanup:
            cleanup.query(InviteCode).filter_by(id=invite_id).delete()
            cleanup.commit()


# ------------------------------------------------------------- rate limits


def test_failed_codes_are_rate_limited(
    anon_client: TestClient, db_session: Session, settings_override
) -> None:
    settings_override(invite_failures_per_15_minutes=3)
    make_code(db_session)
    for _ in range(3):
        assert signup(anon_client, "WRONG-CODE").status_code == 400

    blocked = signup(anon_client, "CLUB-2026")

    assert blocked.status_code == 429, "even a good code waits once the failures pile up"
    assert "잠시 후" in blocked.json()["detail"]


def test_signup_attempts_are_rate_limited(
    anon_client: TestClient, db_session: Session, settings_override
) -> None:
    settings_override(signup_attempts_per_hour=2)
    make_code(db_session)
    assert signup(anon_client, "CLUB-2026", username="early1", email="early1@ctrl.ai").status_code == 201
    anon_client.cookies.clear()
    assert signup(anon_client, "CLUB-2026", username="early2", email="early2@ctrl.ai").status_code == 201
    anon_client.cookies.clear()
    assert signup(anon_client, "CLUB-2026", username="early3", email="early3@ctrl.ai").status_code == 429


def test_attempts_are_counted_in_the_database(
    anon_client: TestClient, db_session: Session
) -> None:
    """Two API workers share the count only if it lives in the database."""
    from app.models import SignupAttempt

    signup(anon_client, "WRONG-CODE")

    rows = db_session.query(SignupAttempt).all()
    assert len(rows) == 1
    assert rows[0].failed is True


def test_attempts_older_than_a_day_are_pruned(
    anon_client: TestClient, db_session: Session
) -> None:
    from app.models import SignupAttempt

    db_session.add(
        SignupAttempt(
            address="203.0.113.9",
            failed=True,
            created_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
    )
    db_session.commit()

    signup(anon_client, "WRONG-CODE")

    assert db_session.query(SignupAttempt).filter_by(address="203.0.113.9").count() == 0


def test_a_code_is_required_in_the_beta_too(
    anon_client: TestClient, db_session: Session, settings_override
) -> None:
    """prep-beta-launch point 2's first bullet, checked under APP_ENV=beta."""
    app.dependency_overrides[get_settings] = lambda: Settings(app_env="beta")
    make_code(db_session)

    assert signup(anon_client, None).status_code == 400
    assert signup(anon_client, "CLUB-2026").status_code == 201


def _request(peer: str, forwarded: str = ""):
    headers = {"x-forwarded-for": forwarded} if forwarded else {}
    return SimpleNamespace(client=SimpleNamespace(host=peer), headers=headers)


def test_forwarded_addresses_are_believed_only_from_trusted_proxies() -> None:
    settings = Settings(trusted_proxies="127.0.0.1,10.0.0.0/8")
    # Through the Next.js proxy: the address it saw.
    assert rate_limit.client_address(_request("127.0.0.1", "203.0.113.7"), settings) == "203.0.113.7"
    # A forged entry to the left changes nothing: the rightmost one counts.
    assert (
        rate_limit.client_address(_request("10.1.2.3", "1.1.1.1, 203.0.113.7"), settings)
        == "203.0.113.7"
    )
    # Straight from the internet: the header is ignored.
    assert rate_limit.client_address(_request("198.51.100.9", "1.1.1.1"), settings) == "198.51.100.9"


# ------------------------------------------------------------- admin


def test_invite_admin_is_admin_only(other_client: TestClient, db_session: Session) -> None:
    invite = make_code(db_session)
    assert other_client.get("/api/admin/invites").status_code == 403
    assert other_client.post("/api/admin/invites", json={}).status_code == 403
    assert other_client.post(f"/api/admin/invites/{invite.id}/deactivate").status_code == 403
    assert other_client.post(f"/api/admin/invites/{invite.id}/reactivate").status_code == 403


def test_admin_creates_a_generated_code_and_it_is_audited(
    client: TestClient, db_session: Session
) -> None:
    response = client.post(
        "/api/admin/invites", json={"label": "2026 Q4 공지용", "max_uses": 40}
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["code"].startswith("CTRL-") and len(body["code"]) == 14
    assert not set(body["code"][5:].replace("-", "")) & set("01OIL"), "nothing that reads alike"
    assert (body["status"], body["uses"], body["max_uses"]) == ("usable", 0, 40)

    entry = db_session.query(AuditLog).filter_by(action="invite.created").one()
    assert body["code"] in entry.summary and "2026 Q4 공지용" in entry.summary


def test_a_custom_code_is_normalised_and_checked(client: TestClient) -> None:
    made = client.post("/api/admin/invites", json={"code": " club-welcome ", "max_uses": 1})
    assert made.status_code == 201
    assert made.json()["code"] == "CLUB-WELCOME"
    assert client.post("/api/admin/invites", json={"code": "CLUB-WELCOME"}).status_code == 409
    assert client.post("/api/admin/invites", json={"code": "a b"}).status_code == 400
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    assert client.post("/api/admin/invites", json={"expires_at": past}).status_code == 400
    assert client.post("/api/admin/invites", json={"max_uses": 0}).status_code == 422


def test_the_list_shows_status_and_who_signed_up(
    client: TestClient, db_session: Session
) -> None:
    invite = make_code(db_session, "SEEN-CODE", max_uses=1)
    make_code(db_session, "OLD-CODE", expires_at=datetime.now(timezone.utc) - timedelta(days=1))
    make_code(db_session, "OFF-CODE", is_active=False)
    guest = TestClient(app)
    assert signup(guest, "SEEN-CODE").status_code == 201

    rows = {row["code"]: row for row in client.get("/api/admin/invites").json()}

    assert rows["SEEN-CODE"]["status"] == "exhausted"
    assert [s["username"] for s in rows["SEEN-CODE"]["signups"]] == ["invited"]
    assert rows["OLD-CODE"]["status"] == "expired"
    assert rows["OFF-CODE"]["status"] == "disabled"
    assert rows["SEEN-CODE"]["uses"] == 1 == invite.max_uses


def test_deactivating_and_reactivating_are_audited(
    client: TestClient, db_session: Session
) -> None:
    invite = make_code(db_session)
    off = client.post(f"/api/admin/invites/{invite.id}/deactivate").json()
    assert (off["is_active"], off["status"]) == (False, "disabled")
    # Doing it again changes nothing and logs nothing.
    client.post(f"/api/admin/invites/{invite.id}/deactivate")
    on = client.post(f"/api/admin/invites/{invite.id}/reactivate").json()
    assert on["status"] == "usable"

    actions = [row.action for row in db_session.query(AuditLog).order_by(AuditLog.id)]
    assert actions == ["invite.deactivated", "invite.reactivated"]
    assert client.post("/api/admin/invites/9999/deactivate").status_code == 404



def test_ipv6_clients_are_counted_by_their_64_network() -> None:
    settings = Settings(trusted_proxies="127.0.0.1")
    one = rate_limit.client_address(_request("2001:db8:1:2::1"), settings)
    other = rate_limit.client_address(_request("2001:db8:1:2:ffff::9"), settings)
    elsewhere = rate_limit.client_address(_request("2001:db8:1:3::1"), settings)
    assert one == other == "2001:db8:1:2::/64"
    assert elsewhere != one
    assert rate_limit.client_address(_request("::ffff:203.0.113.7"), settings) == "203.0.113.7"
    assert rate_limit.client_address(_request("203.0.113.7"), settings) == "203.0.113.7"
