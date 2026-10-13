"""member-password-login — Google, a password, or both, for every member.

Profile › 로그인 방법 sets, changes and removes a password and unlinks
Google; one of the two must always remain. Against the mock Google
provider, like `test_google_login.py`.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, ConnectedAccount, User
from app.models.audit import AuditAction
from tests.conftest import DEV_PASSWORD
from tests.test_google_login import google_says, make_code, settings_for, start  # noqa: F401

NEW_PASSWORD = "a-brand-new-password"


@pytest.fixture(autouse=True)
def development(settings_for):  # noqa: F811
    settings_for()


def google_member(client: TestClient, db: Session, *, username="gmember", sub="g-gm") -> None:
    """Sign up with Google only and stay signed in."""
    make_code(db)
    google_says(client, start(client), sub=sub, email=f"{username}@example.com")
    made = client.post(
        "/api/auth/google/complete",
        json={"username": username, "display_name": "구글 회원", "invite_code": "CLUB-2026"},
    )
    assert made.status_code == 201, made.text


def sign_out(client: TestClient) -> None:
    client.post("/api/auth/logout")
    client.cookies.clear()


def methods(client: TestClient) -> dict:
    response = client.get("/api/account/sign-in")
    assert response.status_code == 200, response.text
    return response.json()


# ------------------------------------------------------------- password for Google members


def test_a_google_member_sets_a_password_and_signs_in_by_username(
    anon_client: TestClient, db_session: Session
) -> None:
    google_member(anon_client, db_session)
    assert methods(anon_client)["password"] is False

    done = anon_client.put("/api/account/password", json={"new_password": NEW_PASSWORD})
    assert done.status_code == 200, done.text
    assert done.json()["password"] is True and done.json()["google"]["linked"] is True
    assert anon_client.get("/api/auth/me").json()["has_password"] is True

    sign_out(anon_client)
    login = anon_client.post("/api/auth/login", json={"username": "gmember", "password": NEW_PASSWORD})
    assert login.status_code == 200, login.text

    stored = db_session.scalar(select(User).where(User.username == "gmember"))
    assert stored.password_hash.startswith("$argon2id$")
    actions = db_session.scalars(select(AuditLog.action)).all()
    assert AuditAction.PASSWORD_SET in actions


def test_a_short_password_is_refused(anon_client: TestClient, db_session: Session) -> None:
    google_member(anon_client, db_session)
    assert anon_client.put("/api/account/password", json={"new_password": "short"}).status_code == 422


def test_changing_a_password_needs_the_current_one(client: TestClient, db_session: Session) -> None:
    wrong = client.put(
        "/api/account/password", json={"current_password": "nope", "new_password": NEW_PASSWORD}
    )
    assert wrong.status_code == 400
    assert "올바르지 않습니다" in wrong.json()["detail"]
    missing = client.put("/api/account/password", json={"new_password": NEW_PASSWORD})
    assert missing.status_code == 400

    done = client.put(
        "/api/account/password",
        json={"current_password": DEV_PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert done.status_code == 200, done.text
    # This browser stays signed in.
    assert client.get("/api/auth/me").status_code == 200
    actions = db_session.scalars(select(AuditLog.action)).all()
    assert AuditAction.PASSWORD_CHANGED in actions


def test_changing_the_password_signs_out_other_browsers(
    client: TestClient, anon_client: TestClient, db_session: Session, dev_user
) -> None:
    from app.main import app

    with TestClient(app) as other:
        assert (
            other.post(
                "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
            ).status_code
            == 200
        )
        client.put(
            "/api/account/password",
            json={"current_password": DEV_PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert other.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").status_code == 200


def test_wrong_current_passwords_count_towards_the_sign_in_limit(
    client: TestClient, settings_for, dev_user  # noqa: F811
) -> None:
    settings_for(login_failures_per_15_minutes=3)
    for _ in range(3):
        client.put(
            "/api/account/password", json={"current_password": "guess", "new_password": NEW_PASSWORD}
        )
    blocked = client.put(
        "/api/account/password",
        json={"current_password": DEV_PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert blocked.status_code == 429
    # And the sign-in form is blocked for the same guesses.
    login = client.post(
        "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
    )
    assert login.status_code == 429


# ------------------------------------------------------------- the last method stays


def test_the_only_password_cannot_be_removed(client: TestClient) -> None:
    refused = client.post("/api/account/password/remove", json={"current_password": DEV_PASSWORD})
    assert refused.status_code == 409
    assert "하나만 남아" in refused.json()["detail"]
    assert methods(client)["password"] is True


def test_the_only_google_link_cannot_be_unlinked(anon_client: TestClient, db_session: Session) -> None:
    google_member(anon_client, db_session)
    refused = anon_client.post("/api/account/google/unlink", json={"current_password": "x"})
    assert refused.status_code == 409
    assert methods(anon_client)["google"]["linked"] is True


def test_with_both_either_can_go_but_not_both(anon_client: TestClient, db_session: Session) -> None:
    google_member(anon_client, db_session)
    anon_client.put("/api/account/password", json={"new_password": NEW_PASSWORD})

    removed = anon_client.post("/api/account/password/remove", json={"current_password": NEW_PASSWORD})
    assert removed.status_code == 200, removed.text
    assert removed.json() == {
        "password": False,
        "google": {"available": True, "linked": True, "email": "gmember@example.com"},
    }
    # The password no longer opens the account.
    stored = db_session.scalar(select(User).where(User.username == "gmember"))
    assert stored.password_hash == "!"

    # Now Google is the last one.
    assert anon_client.post("/api/account/google/unlink", json={"current_password": "x"}).status_code == 409


def test_a_password_member_unlinks_google_with_their_password(
    client: TestClient, db_session: Session, dev_user
) -> None:
    google_says(client, start(client, "/api/account/google/link/start"), sub="g-dev", email="dev@g.com")
    assert methods(client)["google"]["linked"] is True

    wrong = client.post("/api/account/google/unlink", json={"current_password": "nope"})
    assert wrong.status_code == 400
    done = client.post("/api/account/google/unlink", json={"current_password": DEV_PASSWORD})
    assert done.status_code == 200, done.text
    assert done.json()["google"]["linked"] is False
    assert db_session.scalar(select(ConnectedAccount)) is None
    actions = db_session.scalars(select(AuditLog.action)).all()
    assert AuditAction.GOOGLE_UNLINKED in actions

    # That Google account no longer opens dev's account: it goes to sign-up.
    sign_out(client)
    response = google_says(client, start(client), sub="g-dev", email="dev@g.com")
    assert response.headers["location"] == "/signup/google"


def test_removing_the_password_is_checked_again_under_the_lock(
    client: TestClient, db_session: Session, dev_user
) -> None:
    """The guard reads the database, not what this request loaded first."""
    google_says(client, start(client, "/api/account/google/link/start"), sub="g-dev", email="dev@g.com")
    # Another request unlinked Google after this one was authorised.
    db_session.delete(db_session.scalar(select(ConnectedAccount)))
    db_session.commit()
    refused = client.post("/api/account/password/remove", json={"current_password": DEV_PASSWORD})
    assert refused.status_code == 409
    assert methods(client)["password"] is True


def test_sign_in_methods_need_a_signed_in_member(anon_client: TestClient) -> None:
    assert anon_client.get("/api/account/sign-in").status_code == 401
    assert anon_client.put("/api/account/password", json={"new_password": NEW_PASSWORD}).status_code == 401
    assert anon_client.post("/api/account/password/remove", json={"current_password": "x"}).status_code == 401
    assert anon_client.post("/api/account/google/unlink", json={"current_password": "x"}).status_code == 401


# ------------------------------------------------------------- rules kept


def test_a_member_who_set_a_password_withdraws_with_it(
    anon_client: TestClient, db_session: Session
) -> None:
    google_member(anon_client, db_session, username="leaver")
    anon_client.put("/api/account/password", json={"new_password": NEW_PASSWORD})
    # The username is no longer enough: the password is the deliberate step.
    by_name = anon_client.post("/api/account/withdrawal", json={"confirm_username": "leaver"})
    assert by_name.status_code == 400
    done = anon_client.post("/api/account/withdrawal", json={"password": NEW_PASSWORD})
    assert done.status_code == 200, done.text


def test_a_password_member_signs_up_and_signs_in_without_google(
    anon_client: TestClient, invite_code
) -> None:
    made = anon_client.post(
        "/api/auth/register",
        json={
            "username": "pwmember",
            "email": "pw@example.com",
            "password": NEW_PASSWORD,
            "display_name": "비번 회원",
            "invite_code": invite_code.code,
        },
    )
    assert made.status_code == 201, made.text
    assert methods(anon_client) == {
        "password": True,
        "google": {"available": True, "linked": False, "email": ""},
    }
    sign_out(anon_client)
    assert (
        anon_client.post(
            "/api/auth/login", json={"username": "pwmember", "password": NEW_PASSWORD}
        ).status_code
        == 200
    )


def test_removing_both_at_once_leaves_one(pg_engine) -> None:
    """Two requests at the same moment: one removes the password, the other
    unlinks Google. Without the row lock both read "the other is still
    there" and the member is locked out. On PostgreSQL (SQLite ignores
    FOR UPDATE); skips without the test database."""
    import threading
    import uuid

    from fastapi import HTTPException
    from sqlalchemy.orm import sessionmaker

    from app.api.routes.sign_in_methods import drop_google, drop_password
    from app.core.config import Settings
    from app.core.security import hash_password
    from app.models import AccountStatus, UserRole

    Session_ = sessionmaker(bind=pg_engine, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    with Session_() as setup:
        member = User(
            username=f"both_{tag}",
            email=f"both_{tag}@ctrl.ai",
            password_hash=hash_password(NEW_PASSWORD),
            display_name="둘 다",
            role=UserRole.MEMBER,
            account_status=AccountStatus.ACTIVE,
        )
        setup.add(member)
        setup.flush()
        setup.add(
            ConnectedAccount(
                user_id=member.id,
                provider="google",
                provider_account_id=f"g-{tag}",
                email=f"both_{tag}@gmail.com",
                scopes="openid email profile",
            )
        )
        setup.commit()
        member_id = member.id

    try:
        for _ in range(5):
            start_line = threading.Barrier(2)
            outcomes: list[str] = []

            def attempt(action) -> None:
                with Session_() as session:
                    person = session.get(User, member_id)
                    start_line.wait()
                    try:
                        action(session, person)
                        outcomes.append("ok")
                    except HTTPException as refused:
                        outcomes.append(str(refused.status_code))

            threads = [
                threading.Thread(
                    target=attempt,
                    args=(lambda session, person: drop_password(session, person, Settings(app_env="development")),),
                ),
                threading.Thread(target=attempt, args=(drop_google,)),
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

            assert sorted(outcomes) == ["409", "ok"], outcomes
            with Session_() as check:
                person = check.get(User, member_id)
                linked = check.scalar(
                    select(ConnectedAccount).where(ConnectedAccount.user_id == member_id)
                )
                assert (person.password_hash != "!") or (linked is not None)
                # Put both back for the next round.
                person.password_hash = hash_password(NEW_PASSWORD)
                if linked is None:
                    check.add(
                        ConnectedAccount(
                            user_id=member_id,
                            provider="google",
                            provider_account_id=f"g-{tag}",
                            email=f"both_{tag}@gmail.com",
                            scopes="openid email profile",
                        )
                    )
                check.commit()
    finally:
        with Session_() as cleanup:
            cleanup.query(AuditLog).filter(AuditLog.target_id == member_id).delete()
            cleanup.query(ConnectedAccount).filter_by(user_id=member_id).delete()
            cleanup.query(User).filter_by(id=member_id).delete()
            cleanup.commit()


def test_the_dev_seed_has_one_account_for_each_way_in(db_session: Session, anon_client: TestClient) -> None:
    from app.db.init_db import (
        DEV_MEMBER_PASSWORD,
        DEV_UNUSED_INVITE_CODE,
        seed_dev_user,
        seed_sign_in_accounts,
    )
    from app.models import InviteCode

    seed_dev_user(db_session)
    seed_sign_in_accounts(db_session)
    seed_sign_in_accounts(db_session)  # idempotent

    def ways_in(username: str) -> tuple[bool, bool]:
        user = db_session.scalar(select(User).where(User.username == username))
        google = db_session.scalar(select(ConnectedAccount).where(ConnectedAccount.user_id == user.id))
        return user.password_hash != "!", google is not None

    assert ways_in("dev") == (True, False)
    assert ways_in("pw_member") == (True, False)
    assert ways_in("google_member") == (False, True)
    assert ways_in("both_member") == (True, True)
    code = db_session.scalar(select(InviteCode).where(InviteCode.code == DEV_UNUSED_INVITE_CODE))
    assert code.max_uses == 1 and code.uses == 0

    # The password accounts really sign in.
    for name in ("pw_member", "both_member"):
        login = anon_client.post("/api/auth/login", json={"username": name, "password": DEV_MEMBER_PASSWORD})
        assert login.status_code == 200, login.text
        sign_out(anon_client)
    # And the Google ones through the mock, by sub.
    response = google_says(anon_client, start(anon_client), sub="mock-sub-google-member", email="x@y.z")
    assert response.headers["location"] == "/"
    assert anon_client.get("/api/auth/me").json()["username"] == "google_member"



# ------------------------------------------------------------- review round 1


def _age_sessions(db: Session, minutes: int) -> None:
    from datetime import datetime, timedelta, timezone

    from app.models import UserSession

    for row in db.scalars(select(UserSession)):
        row.created_at = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    db.commit()


def test_a_first_password_needs_a_recent_sign_in(anon_client: TestClient, db_session: Session) -> None:
    google_member(anon_client, db_session)
    _age_sessions(db_session, 30)
    refused = anon_client.put("/api/account/password", json={"new_password": NEW_PASSWORD})
    assert refused.status_code == 403
    assert "다시 로그인" in refused.json()["detail"]
    assert methods(anon_client)["password"] is False


def test_linking_google_needs_a_recent_sign_in(client: TestClient, db_session: Session) -> None:
    _age_sessions(db_session, 30)
    response = client.get("/api/account/google/link/start", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/profile?google=reauth"


def test_removing_a_method_signs_out_other_browsers(
    client: TestClient, db_session: Session, dev_user
) -> None:
    from app.main import app

    google_says(client, start(client, "/api/account/google/link/start"), sub="g-dev", email="dev@g.com")
    with TestClient(app) as other:
        other.post("/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD})
        assert other.get("/api/auth/me").status_code == 200
        done = client.post("/api/account/google/unlink", json={"current_password": DEV_PASSWORD})
        assert done.status_code == 200, done.text
        assert other.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").status_code == 200


def test_the_password_stays_while_google_sign_in_is_off(
    anon_client: TestClient, db_session: Session, settings_for  # noqa: F811
) -> None:
    google_member(anon_client, db_session)
    anon_client.put("/api/account/password", json={"new_password": NEW_PASSWORD})
    settings_for(google_login_provider="off")
    refused = anon_client.post("/api/account/password/remove", json={"current_password": NEW_PASSWORD})
    assert refused.status_code == 409
    assert "Google 로그인이 꺼져" in refused.json()["detail"]
    assert methods(anon_client)["google"]["available"] is False


def test_withdrawal_password_guesses_count_towards_the_limit(
    client: TestClient, settings_for  # noqa: F811
) -> None:
    settings_for(login_failures_per_15_minutes=2)
    for _ in range(2):
        assert client.post("/api/account/withdrawal", json={"password": "guess"}).status_code == 400
    assert client.post("/api/account/withdrawal", json={"password": DEV_PASSWORD}).status_code == 429


def test_an_email_in_other_case_is_taken(anon_client: TestClient, invite_code, dev_user) -> None:
    made = anon_client.post(
        "/api/auth/register",
        json={
            "username": "copycat",
            "email": dev_user.email.upper(),
            "password": NEW_PASSWORD,
            "display_name": "x",
            "invite_code": invite_code.code,
        },
    )
    assert made.status_code == 409
    assert "이메일" in made.json()["detail"]



# ------------------------------------------------------------- review round 2


def test_with_google_off_an_old_session_is_not_told_to_log_out(
    anon_client: TestClient, db_session: Session, settings_for  # noqa: F811
) -> None:
    google_member(anon_client, db_session)
    _age_sessions(db_session, 30)
    settings_for(google_login_provider="off")
    refused = anon_client.put("/api/account/password", json={"new_password": NEW_PASSWORD})
    assert refused.status_code == 403
    assert "관리자에게 문의" in refused.json()["detail"]
    assert "로그아웃한 뒤" not in refused.json()["detail"]


def test_a_password_changed_meanwhile_is_not_overwritten(
    client: TestClient, db_session: Session, dev_user, monkeypatch
) -> None:
    """The current password is checked, then — before the lock — another
    request changes it. This one must not write over that change."""
    from app.api.routes import sign_in_methods
    from app.core.security import hash_password

    real = sign_in_methods.check_current_password

    def check_then_race(db, request, user, given, settings):
        real(db, request, user, given, settings)
        db.execute(
            User.__table__.update()
            .where(User.id == user.id)
            .values(password_hash=hash_password("changed-elsewhere"))
        )
        db.commit()

    monkeypatch.setattr(sign_in_methods, "check_current_password", check_then_race)
    refused = client.put(
        "/api/account/password",
        json={"current_password": DEV_PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert refused.status_code == 409
    assert "그사이" in refused.json()["detail"]


def test_linking_google_signs_out_other_browsers(
    client: TestClient, db_session: Session, dev_user
) -> None:
    from app.main import app

    with TestClient(app) as other:
        other.post("/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD})
        assert other.get("/api/auth/me").status_code == 200
        response = google_says(client, start(client, "/api/account/google/link/start"), sub="g-dev", email="dev@g.com")
        assert response.headers["location"] == "/profile?google=linked"
        assert other.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").status_code == 200



def test_a_removal_checked_against_an_old_password_is_refused(
    client: TestClient, db_session: Session, dev_user, monkeypatch
) -> None:
    from app.api.routes import sign_in_methods
    from app.core.security import hash_password

    google_says(client, start(client, "/api/account/google/link/start"), sub="g-dev", email="dev@g.com")
    real = sign_in_methods.check_current_password

    def check_then_race(db, request, user, given, settings):
        real(db, request, user, given, settings)
        db.execute(
            User.__table__.update()
            .where(User.id == user.id)
            .values(password_hash=hash_password("changed-elsewhere"))
        )
        db.commit()

    monkeypatch.setattr(sign_in_methods, "check_current_password", check_then_race)
    for path in ("/api/account/password/remove", "/api/account/google/unlink"):
        refused = client.post(path, json={"current_password": DEV_PASSWORD})
        assert refused.status_code == 409, path
        # Back to the password the next request will prove.
        db_session.execute(
            User.__table__.update().where(User.id == dev_user.id).values(password_hash=hash_password(DEV_PASSWORD))
        )
        db_session.commit()
        db_session.expire_all()  # the test shares one session with the app
    monkeypatch.undo()
    assert methods(client) == {
        "password": True,
        "google": {"available": True, "linked": True, "email": "dev@g.com"},
    }
