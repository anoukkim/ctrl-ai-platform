"""quality-tuning Q1: 생각 깊이 — model + depth, decided on the server.

The client sends a model id and a level name; the server maps the name to
an effort, a room (`max_tokens`) and a per-call cap, separately for chat
and the Builder. Mock Claude and fake transports only — nothing reaches
Anthropic.
"""

import json

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes import builder as builder_route
from app.core.config import get_settings
from app.main import app
from app.models import AuditLog, BuilderProject, ChatLimits, ChatModel, Conversation, UsageEvent
from app.services import depth as depth_service
from app.services.claude_provider import AnthropicClaudeProvider
from tests.conftest import JSON_HEADERS, MEMBER_PASSWORD
from app.core.config import Settings
from tests.test_builder_static_runtime import FakeToolTurns
from tests.test_chat import config, events_of, real_claude, send  # noqa: F401


def model_row(db: Session, model_id: str) -> ChatModel:
    return db.scalar(select(ChatModel).where(ChatModel.model_id == model_id))


def conversation_with(client: TestClient, **body) -> int:
    response = client.post("/api/chat/conversations", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def member_client(other_user) -> TestClient:
    signed_in = TestClient(app, headers=JSON_HEADERS)
    assert signed_in.post(
        "/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}
    ).status_code == 200
    return signed_in


# ------------------------------------------------------------ the mapping


def test_each_model_offers_the_depths_its_api_takes() -> None:
    assert depth_service.levels_for("claude-sonnet-5-5") == ("low", "medium", "high", "max")
    assert depth_service.levels_for("claude-opus-5-5") == ("low", "medium", "high", "max")
    # Haiku 4.5 rejects `effort`: no slider, nothing sent.
    assert depth_service.levels_for("claude-haiku-4-5") == ()
    assert depth_service.levels_for("deepseek/deepseek-v4.1-flash") == ()


@pytest.mark.parametrize(
    ("surface", "level", "tokens", "cap"),
    [
        ("chat", "low", 4096, 200),
        ("chat", "medium", 8192, 200),
        ("chat", "high", 16000, 400),
        ("builder", "medium", 16000, 500),
        ("builder", "high", 32000, 900),
    ],
)
def test_a_level_name_becomes_effort_room_and_cap(surface, level, tokens, cap) -> None:
    chosen, effort = depth_service.resolve(None, surface, "claude-sonnet-5-5", level)
    assert (chosen.max_tokens, chosen.cap_krw, effort) == (tokens, cap, level)


def test_a_made_up_level_or_a_model_without_depth_runs_at_medium() -> None:
    chosen, effort = depth_service.resolve(None, "chat", "claude-sonnet-5-5", "ultra")
    assert (chosen.name, effort) == ("medium", "medium")
    chosen, effort = depth_service.resolve(None, "chat", "claude-haiku-4-5", "high")
    assert (chosen.name, effort) == ("medium", None)


def test_the_admins_numbers_are_checked() -> None:
    with pytest.raises(ValueError, match="1회 한도"):
        depth_service.checked_table({"chat": {"low": {"cap_krw": 999_999}}})
    with pytest.raises(ValueError, match="최대 토큰"):
        depth_service.checked_table({"builder": {"high": {"max_tokens": 10}}})


# ------------------------------------------------------------ chat


def test_chat_sends_the_conversations_depth(
    client: TestClient, db_session: Session, budgeted, real_claude
) -> None:
    conversation = conversation_with(client, depth="high")
    send(client, conversation, "어려운 질문")

    body = json.loads(real_claude.requests[0].content)
    assert body["output_config"] == {"effort": "high"}
    assert body["max_tokens"] == 16000
    message_event = db_session.query(UsageEvent).one()
    assert message_event.depth == "high"


def test_sonnet_at_max_thinks_adaptively(client: TestClient, budgeted, real_claude) -> None:
    conversation = conversation_with(client, depth="max")
    send(client, conversation, "아주 어려운 질문")
    body = json.loads(real_claude.requests[0].content)
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "max"}


def test_haiku_gets_no_effort_whatever_depth_is_asked(
    client: TestClient, db_session: Session, budgeted, real_claude
) -> None:
    haiku = model_row(db_session, "claude-haiku-4-5")
    conversation = conversation_with(client, chat_model_id=haiku.id, depth="high")
    send(client, conversation, "안녕")

    body = json.loads(real_claude.requests[0].content)
    assert body["model"] == "claude-haiku-4-5"
    assert "output_config" not in body and "thinking" not in body
    assert body["max_tokens"] == 8192
    assert db_session.query(UsageEvent).one().depth is None


def test_a_tampered_depth_is_refused(client: TestClient, budgeted, config) -> None:
    assert client.post("/api/chat/conversations", json={"depth": "ultra"}).status_code == 422
    conversation = conversation_with(client)
    assert client.patch(
        f"/api/chat/conversations/{conversation}", json={"depth": 99}
    ).status_code == 422
    # A number the client made up is never read: nothing changes.
    assert client.patch(
        f"/api/chat/conversations/{conversation}", json={"max_tokens": 64000}
    ).status_code in (400, 422)


def test_the_picker_price_is_the_cap_the_pre_check_enforces(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    """"(최대 M원)" on the slider is the per-call cap a reply is held to."""
    db_session.add(
        ChatLimits(
            reply_cap_krw=200, long_history_tokens=8000, daily_cap_krw=0,
            depth_levels={"chat": {"low": {"cap_krw": 18}}},
        )
    )
    db_session.commit()
    info = client.get("/api/chat/info").json()
    sonnet = next(row for row in info["models"] if row["model_id"] == "claude-sonnet-5-5")
    low = next(step for step in sonnet["levels"] if step["level"] == "low")
    assert low["max_krw"] == 18
    assert low["estimate_krw"] <= 18
    assert [step["level"] for step in sonnet["levels"]] == ["low", "medium", "high", "max"]
    haiku = next(row for row in info["models"] if row["model_id"] == "claude-haiku-4-5")
    assert haiku["levels"] == []

    conversation = conversation_with(client, depth="low")
    done = [data for name, data in events_of(send(client, conversation, "길게 " * 50).text) if name == "done"]
    assert done
    # The cap is per call (feat-auto-continue): a reply that reaches it is
    # continued by a new call, each held to the same 18원, and the reply's
    # total is what those calls charged. (Before image-generation the
    # mock reply fitted one call at exactly 15원; the longer system prompt
    # tipped it into a continuation; the cap rose from 15 to 18원 when the
    # chat prompt learned about images, so the first call still fits.)
    calls = db_session.query(UsageEvent).all()
    assert calls and all(call.charged_krw <= 18 for call in calls)
    assert done[0]["charged_krw"] == sum(call.charged_krw for call in calls)


def test_the_members_default_is_remembered(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    haiku = model_row(db_session, "claude-haiku-4-5")
    saved = client.patch(
        "/api/account/preferences", json={"default_chat_model_id": haiku.id, "default_depth": "low"}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["default_depth"] == "low"
    assert client.get("/api/chat/info").json()["member_default_depth"] == "low"

    created = client.post("/api/chat/conversations", json={}).json()
    assert (created["chat_model_id"], created["depth"]) == (haiku.id, "low")


def test_a_member_cannot_default_to_an_admin_only_model(
    anon_client: TestClient, db_session: Session, other_user, config
) -> None:
    opus = model_row(db_session, "claude-opus-5-5")
    member = member_client(other_user)
    refused = member.patch("/api/account/preferences", json={"default_chat_model_id": opus.id})
    assert refused.status_code == 400
    assert member.patch("/api/account/preferences", json={"default_depth": "turbo"}).status_code == 422


def test_continuing_a_capped_reply_is_a_new_charged_reply(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    """이어서 쓰기: the button sends "이어서 써 줘" — an ordinary, priced turn.

    With automatic continuation off (전체 한도 0, feat-auto-continue) a
    capped reply stops after one call, as before."""
    db_session.add(
        ChatLimits(
            reply_cap_krw=200, long_history_tokens=8000, daily_cap_krw=0,
            depth_levels={"chat": {"medium": {"cap_krw": 18, "total_cap_krw": 0}}},
        )
    )
    db_session.commit()
    conversation = conversation_with(client)
    first = [d for n, d in events_of(send(client, conversation, "길게 써 줘 " * 20).text) if n == "done"][0]
    second = [d for n, d in events_of(send(client, conversation, "이어서 써 줘").text) if n == "done"][0]
    assert first["charged_krw"] > 0 and second["charged_krw"] > 0
    assert db_session.query(UsageEvent).count() == 2


# ------------------------------------------------------------ the Builder


@pytest.fixture
def builder_config(tmp_path):
    settings = Settings(
        app_env="development",
        chat_mock_delay_ms=0,
        apps_dir=str(tmp_path / "apps"),
        apps_base_url="http://apps.test",
        storage_dir=str(tmp_path / "storage"),
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def builder_claude(monkeypatch, builder_config):
    settings = builder_config.model_copy(
        update={
            "claude_provider": "anthropic",
            "anthropic_api_key": "test-not-a-real-key",
            "anthropic_model": "claude-sonnet-5-5",
        }
    )
    app.dependency_overrides[get_settings] = lambda: settings
    fake = FakeToolTurns()
    monkeypatch.setattr(
        builder_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, http_client=httpx.Client(transport=httpx.MockTransport(fake.handler))
        ),
    )
    return fake


@pytest.fixture
def project(db_session: Session, dev_user) -> BuilderProject:
    row = BuilderProject(owner_user_id=dev_user.id, name="할 일", description="")
    db_session.add(row)
    db_session.commit()
    return row


def test_the_builder_runs_at_the_projects_depth(
    client: TestClient, db_session: Session, project, budgeted, builder_claude
) -> None:
    assert client.patch(f"/api/builder/projects/{project.id}", json={"depth": "high"}).status_code == 200
    estimate = client.get(f"/api/builder/projects/{project.id}/generate-estimate?request=인사말").json()
    assert estimate["depth"] == "high" and estimate["max_krw"] == 900

    response = client.post(f"/api/builder/projects/{project.id}/generate", json={"request": "인사말"})
    assert response.status_code == 200, response.text
    first = builder_claude.requests[0]
    assert first["output_config"] == {"effort": "high"}
    # The estimate's room is the room the call ran with.
    assert first["max_tokens"] == estimate["max_output_tokens"] == 32000
    assert db_session.query(UsageEvent).one().depth == "high"


def test_a_builder_project_on_haiku_sends_no_effort(
    client: TestClient, db_session: Session, project, budgeted, builder_claude
) -> None:
    haiku = model_row(db_session, "claude-haiku-4-5")
    client.patch(f"/api/builder/projects/{project.id}", json={"chat_model_id": haiku.id, "depth": "max"})
    client.post(f"/api/builder/projects/{project.id}/generate", json={"request": "인사말"})
    first = builder_claude.requests[0]
    assert first["model"] == "claude-haiku-4-5"
    assert "output_config" not in first
    assert first["max_tokens"] == 16000


def test_a_builder_cap_too_small_for_a_file_is_refused_free(
    client: TestClient, db_session: Session, project, budgeted, builder_claude
) -> None:
    db_session.add(
        ChatLimits(
            reply_cap_krw=200, long_history_tokens=8000, daily_cap_krw=0,
            depth_levels={"builder": {"medium": {"cap_krw": 10}}},
        )
    )
    db_session.commit()
    response = client.post(f"/api/builder/projects/{project.id}/generate", json={"request": "만들어 줘"})
    assert response.status_code == 400
    assert "생각 깊이를 높여" in response.json()["detail"]
    assert builder_claude.requests == []
    assert db_session.query(UsageEvent).count() == 0


def test_the_builder_picker_lists_models_with_their_depths(
    client: TestClient, project, budgeted, builder_config
) -> None:
    estimate = client.get(f"/api/builder/projects/{project.id}/generate-estimate").json()
    by_id = {row["model_id"]: row for row in estimate["models"]}
    assert len(by_id["claude-sonnet-5-5"]["levels"]) == 4
    assert by_id["claude-haiku-4-5"]["levels"] == []
    # "(최대 M원)" at 보통 is exactly what the pre-check reserves for this
    # project — the 500원 cap, or less when 보통's room costs less.
    medium = by_id["claude-sonnet-5-5"]["levels"][1]
    assert medium["max_krw"] == estimate["worst_case_krw"] <= 500


def test_a_member_cannot_pick_an_admin_only_model_for_a_project(
    anon_client: TestClient, db_session: Session, other_user, participating, builder_config
) -> None:
    from app.models import MembershipStatus
    from app.services.quarters import set_membership

    set_membership(db_session, other_user.id, participating.id, MembershipStatus.ACTIVE)
    db_session.commit()
    row = BuilderProject(owner_user_id=other_user.id, name="내 앱", description="")
    db_session.add(row)
    db_session.commit()
    opus = model_row(db_session, "claude-opus-5-5")
    member = member_client(other_user)
    refused = member.patch(f"/api/builder/projects/{row.id}", json={"chat_model_id": opus.id})
    assert refused.status_code == 400


def test_a_new_project_starts_at_the_members_default(
    client: TestClient, db_session: Session, budgeted, builder_config
) -> None:
    client.patch("/api/account/preferences", json={"default_depth": "high"})
    created = client.post("/api/builder/projects", json={"name": "새 앱", "description": ""}).json()
    assert created["depth"] == "high"


# ------------------------------------------------------------ admin


def test_the_admin_sets_per_depth_numbers_audited(
    client: TestClient, db_session: Session, config
) -> None:
    body = client.get("/api/admin/claude-pricing").json()["chat_limits"]
    assert body["context_tokens"] == 64000 and body["timeout_seconds"] == 180
    for key in ("set_at", "set_by_username"):
        body.pop(key)
    body["depth_levels"]["chat"]["high"]["cap_krw"] = 450
    body["context_tokens"] = 48000
    saved = client.post("/api/admin/claude-pricing/chat-limits", json=body)
    assert saved.status_code == 200, saved.text
    limits = saved.json()["chat_limits"]
    assert limits["depth_levels"]["chat"]["high"]["cap_krw"] == 450
    assert limits["context_tokens"] == 48000
    audit = db_session.scalars(select(AuditLog).order_by(AuditLog.id.desc())).first()
    assert "높음 16,000/450원" in audit.summary and "대화 기억 48,000토큰" in audit.summary

    body["depth_levels"]["chat"]["low"]["cap_krw"] = 999_999
    refused = client.post("/api/admin/claude-pricing/chat-limits", json=body)
    assert refused.status_code == 400 and "1회 한도" in refused.json()["detail"]


def test_admin_budget_splits_claude_usage_by_model_and_depth(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = conversation_with(client, depth="high")
    send(client, conversation, "안녕")
    quarter_id = budgeted.quarter_id
    lines = client.get(f"/api/admin/quarters/{quarter_id}/budget").json()["model_depth"]
    assert any(line["depth"] == "high" and line["feature"] == "chat" and line["events"] == 1 for line in lines)


def test_a_long_silent_reply_is_kept_alive_until_it_finishes(
    client: TestClient, budgeted, config, monkeypatch
) -> None:
    """A long think says nothing for minutes; keepalives keep every proxy
    on the way from closing the stream (the owner's 4-minute check runs
    the same marker through Next.js by hand — see the run log)."""
    from app.api.routes import chat as chat_route

    monkeypatch.setattr(chat_route, "KEEPALIVE_SECONDS", 0.05)
    conversation = conversation_with(client)
    body = send(client, conversation, "[mock-slow:1] 안녕").text
    assert body.count(": keepalive") >= 5
    assert [name for name, _ in events_of(body)][-1] == "done"
