"""app-platform P2 — signing in to a member app, ctrlai.user, ctrlai.ai.

Mock Claude throughout (CLAUDE.md §7). The visitor is the development user
(participating, with a wallet); the app is another member's published
project. The site and the apps origin share one TestClient here, but the
site's session cookie is never what signs anyone in to an app: only the
app's own cookie, set by the callback.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    AppConsent,
    AppLoginCode,
    AppSession,
    AuditLog,
    BuilderProject,
    MembershipStatus,
    UsageEvent,
    User,
)
from app.services import app_ai, app_auth, app_publish, builder_versions
from app.services.quarters import set_membership

APPS = "http://apps.test"

#: app-platform P4: the lists the P3 tests write into as a *visitor* must be
#: declared by the app's owner (ctrlai.json) — a visitor cannot make one.
MANIFEST = json.dumps(
    {
        "db": [
            {"name": "posts", "shared": True},
            {"name": "diary"},
            {"name": "votes", "shared": True},
            {"name": "votes"},
            {"name": "scores", "shared": True},
            {"name": "board", "shared": True},
            {"name": "notes"},
            {"name": "big", "shared": True},
            {"name": "few"},
            {"name": "few2"},
        ]
    }
)
SHOP_FILES = {"index.html": "<!doctype html><head><title>t</title></head>", "ctrlai.json": MANIFEST}


@pytest.fixture
def config(tmp_path):
    settings = Settings(
        app_env="development",
        apps_dir=str(tmp_path / "apps"),
        apps_base_url=APPS,
        cors_allow_origins="http://localhost:3000",
        chat_mock_delay_ms=0,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def shop(db_session: Session, other_user: User, config) -> BuilderProject:
    """Another member's published app."""
    project = BuilderProject(owner_user_id=other_user.id, name="영수증 읽기", description="")
    db_session.add(project)
    db_session.flush()
    builder_versions.replace_files(db_session, project, SHOP_FILES)
    builder_versions.snapshot(db_session, project, "만들기", SHOP_FILES)
    app_publish.publish(db_session, config, project, description="영수증", note="", ai_access="full")
    db_session.commit()
    return project


def headers(project: BuilderProject) -> dict:
    return {"X-CtrlAI-App": project.app_slug, "Sec-Fetch-Site": "same-origin"}


def sign_in(client: TestClient, project: BuilderProject) -> dict:
    """The whole flow, as the browser does it. Returns the v1/app answer."""
    start = client.post("/_ctrlai/v1/login/start", headers=headers(project), json={})
    assert start.status_code == 200, start.text
    url = start.json()["connectUrl"]
    assert url.startswith("http://test/apps/connect?app=") and f"app={project.app_slug}" in url
    state = url.split("state=")[1]
    allowed = client.post(f"/api/app-connect/{project.app_slug}", json={"state": state})
    assert allowed.status_code == 200, allowed.text
    redirect = allowed.json()["redirect_url"]
    assert redirect.startswith(f"{APPS}/{project.app_slug}/_ctrlai/callback?code=")
    query = redirect.split("?", 1)[1]
    landed = client.get(f"/{project.app_slug}/_ctrlai/callback?{query}")
    assert landed.status_code == 200 and 'data-ok="1"' in landed.text
    cookie = landed.headers["set-cookie"]
    assert f"{app_auth.cookie_name(project.app_slug)}=" in cookie
    for part in ("HttpOnly", "Path=/_ctrlai/", "SameSite=strict"):
        assert part.lower() in cookie.lower(), part
    assert "domain=" not in cookie.lower()
    return client.get("/_ctrlai/v1/app", headers=headers(project)).json()


# ------------------------------------------------------------- signing in


def test_the_consent_screen_needs_the_site_session_and_tells_what_the_app_may_do(
    client: TestClient, anon_client: TestClient, shop: BuilderProject
) -> None:
    info = client.get(f"/api/app-connect/{shop.app_slug}").json()
    assert info["name"] == "영수증 읽기" and info["owner_name"] == "Other Member"
    assert [scope["key"] for scope in info["scopes"]] == ["profile", "ai", "data"]
    assert info["call_cap_krw"] == 200 and info["connected"] is False
    assert client.get("/api/app-connect/zzzzzzzzzz").status_code == 404


def test_signed_out_by_default_and_the_site_session_does_not_count(
    client: TestClient, shop: BuilderProject
) -> None:
    """`client` is signed in on the site — the app still sees no one."""
    info = client.get("/_ctrlai/v1/app", headers=headers(shop)).json()
    assert info["signedIn"] is False and info["user"] is None
    assert client.get("/_ctrlai/v1/user", headers=headers(shop)).status_code == 401
    assert client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"}).status_code == 401


def test_the_full_sign_in_gives_a_name_and_a_per_app_id_only(
    client: TestClient, db_session: Session, shop: BuilderProject, dev_user: User
) -> None:
    info = sign_in(client, shop)

    assert info["signedIn"] is True and info["scopes"] == ["profile", "ai", "data"]
    user = client.get("/_ctrlai/v1/user", headers=headers(shop)).json()
    assert set(user) == {"displayName", "appUserId"}
    assert user["displayName"] == dev_user.display_name
    assert user["appUserId"].startswith("u_") and len(user["appUserId"]) == 22
    assert dev_user.email not in str(info) and dev_user.username not in user["appUserId"]
    row = db_session.query(AuditLog).filter_by(action="app_consent.granted").one()
    assert row.target_id == shop.id
    assert db_session.query(AppLoginCode).one().used_at is not None
    # The cookie is stored as a hash only.
    session = db_session.query(AppSession).one()
    assert len(session.token_hash) == 64


def test_a_code_works_once_with_the_browser_s_own_state(
    client: TestClient, anon_client: TestClient, db_session: Session, shop: BuilderProject, dev_user: User
) -> None:
    start = client.post("/_ctrlai/v1/login/start", headers=headers(shop), json={})
    state = start.json()["connectUrl"].split("state=")[1]
    redirect = client.post(f"/api/app-connect/{shop.app_slug}", json={"state": state}).json()["redirect_url"]
    code = redirect.split("code=")[1].split("&")[0]

    # Someone else's browser (no state cookie) cannot spend it …
    other = TestClient(app)
    stolen = other.get(f"/{shop.app_slug}/_ctrlai/callback?code={code}&state={state}")
    assert 'data-ok="0"' in stolen.text
    assert f"{app_auth.cookie_name(shop.app_slug)}=" not in stolen.headers.get("set-cookie", "")
    # … a wrong state neither …
    assert 'data-ok="0"' in client.get(f"/{shop.app_slug}/_ctrlai/callback?code={code}&state=wrong-state-123456").text
    # The state cookie is scoped to the callback address only.
    assert f"Path=/{shop.app_slug}/_ctrlai/" in start.headers["set-cookie"]


def test_expired_reused_or_wrong_app_codes_fail(
    client: TestClient, db_session: Session, shop: BuilderProject, dev_user: User, other_user: User, config
) -> None:
    second = BuilderProject(owner_user_id=other_user.id, name="다른 앱", description="")
    db_session.add(second)
    db_session.flush()
    files = {"index.html": "<!doctype html><head></head>"}
    builder_versions.replace_files(db_session, second, files)
    builder_versions.snapshot(db_session, second, "만들기", files)
    app_publish.publish(db_session, config, second, description="다른", note="")
    app_auth.grant(db_session, dev_user, shop)
    state = "s" * 24
    code = app_auth.issue_code(db_session, dev_user, shop, state)
    db_session.commit()

    assert app_auth.exchange(db_session, second, code, state, state) is None  # another app
    token = app_auth.exchange(db_session, shop, code, state, state)
    assert token is not None
    assert app_auth.exchange(db_session, shop, code, state, state) is None  # used
    late = app_auth.issue_code(db_session, dev_user, shop, state)
    db_session.query(AppLoginCode).filter(AppLoginCode.used_at.is_(None)).update(
        {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}
    )
    assert app_auth.exchange(db_session, shop, late, state, state) is None  # expired


def test_revoking_ends_the_app_sign_in_and_logout_too(
    client: TestClient, db_session: Session, shop: BuilderProject
) -> None:
    sign_in(client, shop)
    consents = client.get("/api/me/app-consents").json()
    assert [row["app_name"] for row in consents] == ["영수증 읽기"]
    assert client.post(f"/api/me/app-consents/{consents[0]['id']}/revoke", json={}).status_code == 200
    assert client.get("/_ctrlai/v1/app", headers=headers(shop)).json()["signedIn"] is False
    assert db_session.query(AuditLog).filter_by(action="app_consent.revoked").count() == 1
    assert client.get("/api/me/app-consents").json() == []

    sign_in(client, shop)
    assert client.post("/_ctrlai/v1/logout", headers=headers(shop), json={}).status_code == 200
    assert client.get("/_ctrlai/v1/app", headers=headers(shop)).json()["signedIn"] is False


# ------------------------------------------------------------------- AI


def test_ask_charges_the_visitor_from_their_wallet(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted, dev_user: User
) -> None:
    sign_in(client, shop)

    answer = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕?"})

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["text"] and body["json"] is None and body["model"] == "fast"
    event = db_session.query(UsageEvent).one()
    assert event.user_id == dev_user.id and event.feature == "app_ai" and event.builder_project_id == shop.id
    assert event.charged_krw == body["chargedKrw"] > 0
    usage = client.get("/api/usage/me").json()
    assert any(row["label"] == "앱 · 영수증 읽기" for row in usage["events"])


def test_json_schema_answers_are_parsed_checked_and_retried_once(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted
) -> None:
    sign_in(client, shop)
    schema = {
        "type": "object",
        "required": ["shop", "total"],
        "properties": {"shop": {"type": "string"}, "total": {"type": "integer", "minimum": 0}},
    }
    good = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "읽어 줘", "json": schema})
    assert good.status_code == 200 and good.json()["json"] == {"shop": "예시", "total": 0}

    retried = client.post(
        "/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "MOCK_BAD_JSON 읽어 줘", "json": schema}
    )
    assert retried.status_code == 200 and retried.json()["json"] == {"shop": "예시", "total": 0}
    assert db_session.query(UsageEvent).count() == 2  # one ledger row per call, retry included

    failed = client.post(
        "/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "MOCK_ALWAYS_BAD_JSON", "json": schema}
    )
    assert failed.status_code == 502 and "JSON" in failed.json()["detail"]
    assert db_session.query(UsageEvent).count() == 3  # the club paid: charged


def test_stream_sends_pieces_then_the_charge(client: TestClient, db_session: Session, shop: BuilderProject, budgeted) -> None:
    sign_in(client, shop)
    with client.stream("POST", "/_ctrlai/v1/ai/stream", headers=headers(shop), json={"prompt": "안녕"}) as response:
        text = "".join(response.iter_text())
    assert "event: delta" in text and "event: done" in text and '"chargedKrw"' in text
    assert db_session.query(UsageEvent).filter_by(feature="app_ai").count() == 1
    refused = client.post("/_ctrlai/v1/ai/stream", headers=headers(shop), json={"prompt": "x", "json": {"type": "object"}})
    assert refused.status_code == 400


def test_only_participating_members_with_the_scope_and_money(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted, dev_user: User
) -> None:
    sign_in(client, shop)
    set_membership(db_session, dev_user.id, budgeted.quarter_id, MembershipStatus.INACTIVE)
    db_session.commit()
    refused = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"})
    assert refused.status_code == 403 and "참여" in refused.json()["detail"]
    set_membership(db_session, dev_user.id, budgeted.quarter_id, MembershipStatus.ACTIVE)
    consent = db_session.query(AppConsent).one()
    consent.scopes = ["profile"]
    db_session.commit()
    assert client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"}).status_code == 403
    assert db_session.query(UsageEvent).count() == 0


def test_the_day_cap_and_the_rate_limit(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted, dev_user: User
) -> None:
    from app.models import ChatLimits

    sign_in(client, shop)
    db_session.add(
        ChatLimits(reply_cap_krw=200, long_history_tokens=8000, daily_cap_krw=0, app_ai_daily_cap_krw=1)
    )
    db_session.commit()
    capped = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"})
    assert capped.status_code == 402 and "오늘" in capped.json()["detail"]

    db_session.add(
        ChatLimits(reply_cap_krw=200, long_history_tokens=8000, daily_cap_krw=0, app_ai_daily_cap_krw=0)
    )
    for _ in range(app_ai.PER_VISITOR_PER_MINUTE):
        db_session.add(
            UsageEvent(
                user_id=dev_user.id,
                quarter_id=budgeted.quarter_id,
                provider="claude",
                funding_source="community",
                feature="app_ai",
                builder_project_id=shop.id,
                charged_krw=1,
            )
        )
    db_session.commit()
    limited = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"})
    assert limited.status_code == 429


def test_the_per_call_cap_shapes_max_tokens(db_session: Session, shop: BuilderProject, budgeted, dev_user: User, config) -> None:
    prepared = app_ai.prepare(
        db_session, config, user=dev_user, project=shop, data=app_ai.AskInput(prompt="안녕", max_tokens=4096)
    )
    worst = prepared.price.worst_case_krw(prepared.input_estimate, prepared.request.max_tokens)
    assert worst <= app_ai.CALL_CAP_KRW
    assert prepared.request.system.startswith(app_ai.SAFETY_PREAMBLE)
    with pytest.raises(app_ai.AppAIError) as long_input:
        app_ai.prepare(db_session, config, user=dev_user, project=shop, data=app_ai.AskInput(prompt="가" * 20_001))
    assert long_input.value.status_code == 400


def test_images_are_checked(client: TestClient, shop: BuilderProject, budgeted) -> None:
    import base64
    import io

    from PIL import Image

    sign_in(client, shop)
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buffer, format="PNG")
    good = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
    assert client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "뭐야", "images": [good]}).status_code == 200
    bad = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "뭐야", "images": ["http://x/y.png"]})
    assert bad.status_code == 400
    huge = "data:image/png;base64," + base64.b64encode(b"\x89PNG" + b"0" * (5 * 1024 * 1024 + 1)).decode()
    assert client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "뭐야", "images": [huge]}).status_code == 413


# ---------------------------------------------------------- the kill switch


def test_the_admin_stops_and_resumes_an_app_s_sdk(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted
) -> None:
    sign_in(client, shop)
    assert client.post(f"/api/admin/apps/{shop.id}/sdk", json={"enabled": False}).status_code == 400
    stopped = client.post(f"/api/admin/apps/{shop.id}/sdk", json={"enabled": False, "reason": "비용 이상"})
    assert stopped.status_code == 200
    assert client.get("/_ctrlai/v1/app", headers=headers(shop)).json()["sdk"] == "off"
    refused = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"})
    assert refused.status_code == 403 and "멈췄" in refused.json()["detail"]
    assert client.get(f"/api/app-connect/{shop.app_slug}").status_code == 403
    assert client.get("/api/admin/apps").json()[0]["sdk_enabled"] is False
    assert client.post(f"/api/admin/apps/{shop.id}/sdk", json={"enabled": True}).status_code == 200
    assert db_session.query(AuditLog).filter_by(action="app.sdk_set").count() == 2


def test_a_member_cannot_stop_an_app(other_client: TestClient, shop: BuilderProject) -> None:
    assert other_client.post(f"/api/admin/apps/{shop.id}/sdk", json={"enabled": False, "reason": "x"}).status_code == 403


# ------------------------------------------------------------- the pieces


def test_the_schema_checker() -> None:
    schema = {
        "type": "object",
        "required": ["items"],
        "additionalProperties": False,
        "properties": {"items": {"type": "array", "minItems": 1, "items": {"type": "string", "enum": ["a", "b"]}}},
    }
    assert app_ai.validate({"items": ["a"]}, schema) is None
    assert "빠졌어요" in app_ai.validate({}, schema)
    assert "정의되지 않은" in app_ai.validate({"items": ["a"], "x": 1}, schema)
    assert "1개 이상" in app_ai.validate({"items": []}, schema)
    assert app_ai.validate({"items": ["c"]}, schema) is not None
    assert app_ai.validate(True, {"type": "integer"}) is not None
    assert app_ai.parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert app_ai.validate(app_ai.sample_for(schema), schema) is None
