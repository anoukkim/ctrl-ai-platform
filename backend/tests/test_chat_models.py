"""chat-model-choice — the catalogue, the picker's rules, and what is charged.

Everything runs on the mock Claude provider or on the real adapter talking
to a local fake transport. No request leaves the machine.
"""

import json
import math
from decimal import Decimal

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import chat as chat_route
from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    AuditLog,
    ChatMessage,
    ChatModel,
    ChatModelVisibility,
    ChatRole,
    Conversation,
    UsageEvent,
)
from app.services.claude_provider import AnthropicClaudeProvider
from tests.test_chat import FakeAnthropic, events_of, send


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def model(db: Session, model_id: str) -> ChatModel:
    return db.query(ChatModel).filter_by(model_id=model_id).one()


def set_visibility(db: Session, model_id: str, visibility: ChatModelVisibility) -> ChatModel:
    row = model(db, model_id)
    row.visibility = visibility
    db.commit()
    return row


def usd(
    event: UsageEvent, input_price: int, output_price: int, read_price: str | None = None
) -> Decimal:
    """What the event cost: uncached input, cache writes at 1.25x input
    (5-minute TTL), cache reads at the model's read price (a tenth of input
    unless given), and output."""
    read = Decimal(read_price) if read_price is not None else Decimal(input_price) / 10
    return (
        Decimal(event.input_tokens) * input_price
        + Decimal(event.cache_write_tokens or 0) * Decimal(input_price) * Decimal("1.25")
        + Decimal(event.cache_read_tokens or 0) * read
        + Decimal(event.output_tokens) * output_price
    ) / 1_000_000


# ------------------------------------------------------------- the seed


def test_the_seeded_catalogue_matches_the_spec(db_session: Session) -> None:
    rows = {row.model_id: row for row in db_session.query(ChatModel).all()}
    assert set(rows) == {
        "claude-haiku-4-5",
        "claude-sonnet-5-5",
        "claude-opus-5-5",
        # admin-and-nav-cleanup: listed, closed, until its adapter exists.
        "deepseek/deepseek-v4.1-flash",
    }
    assert {r.provider for r in rows.values()} == {"anthropic", "deepseek"}
    assert rows["deepseek/deepseek-v4.1-flash"].visibility is ChatModelVisibility.DISABLED
    assert rows["claude-haiku-4-5"].visibility is ChatModelVisibility.MEMBERS
    assert rows["claude-sonnet-5-5"].visibility is ChatModelVisibility.MEMBERS
    assert rows["claude-opus-5-5"].visibility is ChatModelVisibility.ADMIN
    assert [m for m, r in rows.items() if r.is_default] == ["claude-sonnet-5-5"]
    assert (rows["claude-haiku-4-5"].input_usd_per_mtok, rows["claude-haiku-4-5"].output_usd_per_mtok) == (1, 5)
    assert (rows["claude-opus-5-5"].input_usd_per_mtok, rows["claude-opus-5-5"].output_usd_per_mtok) == (4, 20)
    for row in rows.values():
        assert row.label and row.description, "every model has a Korean label and a description"


# ------------------------------------------------------------- the picker


def test_a_member_is_offered_only_member_models_with_an_estimate(
    other_client: TestClient, db_session: Session, config
) -> None:
    info = other_client.get("/api/chat/info").json()
    offered = {m["model_id"]: m for m in info["models"]}
    assert set(offered) == {"claude-haiku-4-5", "claude-sonnet-5-5"}
    assert info["default_model_id"] == model(db_session, "claude-sonnet-5-5").id
    assert offered["claude-sonnet-5-5"]["is_default"] is True
    # 3,000 in + 800 out at $2/$10 and 1,400원 = $0.014 → 19.6 → 20원.
    assert offered["claude-sonnet-5-5"]["estimated_reply_krw"] == 20
    assert offered["claude-haiku-4-5"]["estimated_reply_krw"] == 10
    assert "input_usd_per_mtok" not in json.dumps(info), "members see won, not dollar prices"


def test_an_admin_is_also_offered_admin_only_models_marked_as_such(
    client: TestClient, config
) -> None:
    offered = {m["model_id"]: m for m in client.get("/api/chat/info").json()["models"]}
    assert offered["claude-opus-5-5"]["admin_only"] is True
    assert offered["claude-opus-5-5"]["estimated_reply_krw"] == 40
    assert offered["claude-haiku-4-5"]["admin_only"] is False


def test_a_disabled_model_is_offered_to_nobody(
    client: TestClient, db_session: Session, config
) -> None:
    set_visibility(db_session, "claude-haiku-4-5", ChatModelVisibility.DISABLED)
    offered = {m["model_id"] for m in client.get("/api/chat/info").json()["models"]}
    assert "claude-haiku-4-5" not in offered


# ------------------------------------------------------------- refusals


@pytest.mark.parametrize(
    "model_id, visibility",
    [
        ("claude-opus-5-5", ChatModelVisibility.ADMIN),
        ("claude-haiku-4-5", ChatModelVisibility.DISABLED),
    ],
)
def test_admin_only_and_disabled_models_are_refused_for_a_member(
    other_client: TestClient,
    db_session: Session,
    other_participating,
    config,
    model_id: str,
    visibility: ChatModelVisibility,
) -> None:
    row = set_visibility(db_session, model_id, visibility)

    created = other_client.post("/api/chat/conversations", json={"chat_model_id": row.id})
    assert created.status_code == 400
    assert "고를 수 없는 모델" in created.json()["detail"]

    conversation = other_client.post("/api/chat/conversations", json={}).json()["id"]
    changed = other_client.patch(
        f"/api/chat/conversations/{conversation}", json={"chat_model_id": row.id}
    )
    assert changed.status_code == 400
    assert "고를 수 없는 모델" in changed.json()["detail"]


def test_a_model_that_does_not_exist_gets_the_same_refusal(
    other_client: TestClient, other_participating, config
) -> None:
    response = other_client.post("/api/chat/conversations", json={"chat_model_id": 9999})
    assert response.status_code == 400
    assert "고를 수 없는 모델" in response.json()["detail"]


def test_a_model_closed_after_it_was_chosen_is_refused_at_send_time_and_costs_nothing(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    haiku = model(db_session, "claude-haiku-4-5")
    conversation = client.post("/api/chat/conversations", json={"chat_model_id": haiku.id}).json()
    set_visibility(db_session, "claude-haiku-4-5", ChatModelVisibility.DISABLED)

    response = send(client, conversation["id"], "안녕하세요")

    assert response.status_code == 400
    assert "다른 모델을 골라" in response.json()["detail"]
    assert db_session.query(UsageEvent).count() == 0
    assert db_session.query(ChatMessage).count() == 0


def test_an_admin_may_use_an_admin_only_model(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    opus = model(db_session, "claude-opus-5-5")
    conversation = client.post("/api/chat/conversations", json={"chat_model_id": opus.id}).json()
    assert conversation["chat_model_id"] == opus.id

    send(client, conversation["id"], "안녕하세요")

    event = db_session.query(UsageEvent).one()
    assert event.model_id == "claude-opus-5-5"
    assert event.charged_krw == math.ceil(usd(event, 4, 20, "0.20") * 1400)


# ------------------------------------------------------------- price and record


def test_the_budget_check_and_the_charge_use_the_chosen_models_price(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    haiku = model(db_session, "claude-haiku-4-5")
    conversation = client.post("/api/chat/conversations", json={"chat_model_id": haiku.id}).json()

    # At 보통's room (8,192 tokens, quality-tuning Q1) Sonnet's worst case
    # ($10) is 115원 or more; Haiku's ($5) fits in 80원. Only the chosen
    # model's price lets this through.
    budgeted.budget_krw = 80
    db_session.commit()
    done = events_of(send(client, conversation["id"], "안녕하세요").text)[-1][1]

    event = db_session.query(UsageEvent).one()
    assert event.model_id == "claude-haiku-4-5"
    assert event.provider_cost == usd(event, 1, 5).quantize(Decimal("0.000001"))
    assert event.charged_krw == math.ceil(usd(event, 1, 5) * 1400) == done["charged_krw"]

    reply = db_session.query(ChatMessage).filter_by(role=ChatRole.ASSISTANT).one()
    assert reply.model_id == "claude-haiku-4-5"
    assert done["message"]["model_id"] == "claude-haiku-4-5"


def test_the_same_budget_refuses_the_default_model(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = client.post("/api/chat/conversations", json={}).json()
    budgeted.budget_krw = 80
    db_session.commit()
    assert send(client, conversation["id"], "안녕하세요").status_code == 402


def test_the_real_adapter_sends_the_chosen_model(
    client: TestClient, db_session: Session, budgeted, monkeypatch, config
) -> None:
    settings = config.model_copy(
        update={"claude_provider": "anthropic", "anthropic_api_key": "sk-ant-test-x"}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    fake = FakeAnthropic()
    monkeypatch.setattr(
        chat_route,
        "get_claude_provider",
        lambda _s: AnthropicClaudeProvider(
            settings,
            async_http_client=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)),
        ),
    )
    haiku = model(db_session, "claude-haiku-4-5")
    conversation = client.post("/api/chat/conversations", json={"chat_model_id": haiku.id}).json()

    send(client, conversation["id"], "안녕하세요")

    body = json.loads(fake.requests[0].content)
    assert body["model"] == "claude-haiku-4-5"
    assert "thinking" not in body and "output_config" not in body, "Haiku takes neither"
    assert db_session.query(UsageEvent).one().model_id == "claude-haiku-4-5"


# ------------------------------------------------------------- per conversation


def test_new_conversations_use_the_default(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    sonnet = model(db_session, "claude-sonnet-5-5")
    assert client.post("/api/chat/conversations", json={}).json()["chat_model_id"] == sonnet.id

    # The admin makes Haiku the default: new conversations follow, older ones keep theirs.
    haiku = model(db_session, "claude-haiku-4-5")
    assert client.patch(f"/api/admin/chat-models/{haiku.id}", json={"is_default": True}).status_code == 200
    newer = client.post("/api/chat/conversations", json={}).json()
    assert newer["chat_model_id"] == haiku.id
    first = client.get("/api/chat/conversations").json()[-1]
    assert first["chat_model_id"] == sonnet.id


def test_the_choice_persists_per_conversation_and_affects_later_replies_only(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    haiku = model(db_session, "claude-haiku-4-5")
    first = client.post("/api/chat/conversations", json={}).json()["id"]
    second = client.post("/api/chat/conversations", json={}).json()["id"]

    send(client, first, "첫 질문")
    changed = client.patch(f"/api/chat/conversations/{first}", json={"chat_model_id": haiku.id})
    assert changed.status_code == 200
    send(client, first, "두 번째 질문")
    send(client, second, "다른 대화")

    detail = client.get(f"/api/chat/conversations/{first}").json()
    assert detail["chat_model_id"] == haiku.id
    replies = [m["model_id"] for m in detail["messages"] if m["role"] == "assistant"]
    assert replies == ["claude-sonnet-5-5", "claude-haiku-4-5"]

    other = client.get(f"/api/chat/conversations/{second}").json()
    assert [m["model_id"] for m in other["messages"] if m["role"] == "assistant"] == [
        "claude-sonnet-5-5"
    ]
    events = db_session.query(UsageEvent).order_by(UsageEvent.id).all()
    assert [e.model_id for e in events] == [
        "claude-sonnet-5-5",
        "claude-haiku-4-5",
        "claude-sonnet-5-5",
    ]


def test_renaming_keeps_the_model(client: TestClient, db_session: Session, budgeted, config) -> None:
    haiku = model(db_session, "claude-haiku-4-5")
    conversation = client.post("/api/chat/conversations", json={"chat_model_id": haiku.id}).json()
    renamed = client.patch(f"/api/chat/conversations/{conversation['id']}", json={"title": "새 이름"})
    assert renamed.json()["chat_model_id"] == haiku.id
    assert client.patch(f"/api/chat/conversations/{conversation['id']}", json={}).status_code == 400


def test_a_conversation_from_before_the_catalogue_uses_the_default(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    old = Conversation(user_id=dev_user.id, title="예전 대화", chat_model_id=None)
    db_session.add(old)
    db_session.commit()
    send(client, old.id, "안녕")
    assert db_session.query(UsageEvent).one().model_id == "claude-sonnet-5-5"


def test_an_empty_catalogue_falls_back_to_anthropic_model(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    db_session.query(ChatModel).delete()
    db_session.commit()
    app.dependency_overrides[get_settings] = lambda: config.model_copy(
        update={"anthropic_model": "claude-opus-5-5"}
    )
    conversation = client.post("/api/chat/conversations", json={}).json()
    assert conversation["chat_model_id"] is None

    send(client, conversation["id"], "안녕")

    event = db_session.query(UsageEvent).one()
    assert event.model_id == "claude-opus-5-5"
    assert event.charged_krw == math.ceil(usd(event, 4, 20) * 1400)


# ------------------------------------------------------------- the prompt helper


def test_the_video_prompt_helper_keeps_the_default_model(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    haiku = model(db_session, "claude-haiku-4-5")
    conversation = client.post("/api/chat/conversations", json={"chat_model_id": haiku.id}).json()
    send(client, conversation["id"], "안녕")

    project = client.post("/api/video/projects", json={"name": "도움 테스트"}).json()
    response = client.post(
        f"/api/video/projects/{project['id']}/prompt-help",
        json={"prompt": "서울의 밤", "request": "더 어둡게"},
    )
    assert response.status_code == 200, response.text

    helper = db_session.query(UsageEvent).filter_by(feature="video_prompt").one()
    assert helper.model_id == "claude-sonnet-5-5"
    assert helper.charged_krw == math.ceil(usd(helper, 2, 10) * 1400)


# ------------------------------------------------------------- admin


def test_the_catalogue_admin_is_admin_only(other_client: TestClient, db_session, config) -> None:
    sonnet = model(db_session, "claude-sonnet-5-5")
    assert other_client.get("/api/admin/chat-models").status_code == 403
    assert other_client.patch(
        f"/api/admin/chat-models/{sonnet.id}", json={"label": "x"}
    ).status_code == 403
    assert other_client.post("/api/admin/chat-models", json={}).status_code == 403


def test_an_admin_change_is_audited_with_both_sides(
    client: TestClient, db_session: Session, config
) -> None:
    haiku = model(db_session, "claude-haiku-4-5")
    response = client.patch(
        f"/api/admin/chat-models/{haiku.id}",
        json={"input_usd_per_mtok": "1.5", "visibility": "admin"},
    )
    assert response.status_code == 200
    assert response.json()["visibility"] == "admin"

    entry = db_session.query(AuditLog).filter_by(action="chat_model.updated").one()
    assert entry.detail["before"] == {"input_usd_per_mtok": "1.0000", "visibility": "members"}
    assert entry.detail["after"]["visibility"] == "admin"
    assert Decimal(entry.detail["after"]["input_usd_per_mtok"]) == Decimal("1.5")
    assert "관리자만" in entry.summary


def test_the_default_must_stay_open_to_members(
    client: TestClient, db_session: Session, config
) -> None:
    sonnet = model(db_session, "claude-sonnet-5-5")
    opus = model(db_session, "claude-opus-5-5")

    closed = client.patch(f"/api/admin/chat-models/{sonnet.id}", json={"visibility": "disabled"})
    assert closed.status_code == 400 and "기본 모델" in closed.json()["detail"]
    unset = client.patch(f"/api/admin/chat-models/{sonnet.id}", json={"is_default": False})
    assert unset.status_code == 400
    admin_only = client.patch(f"/api/admin/chat-models/{opus.id}", json={"is_default": True})
    assert admin_only.status_code == 400

    # Opening Opus and making it the default in one change is allowed, and
    # leaves exactly one default.
    both = client.patch(
        f"/api/admin/chat-models/{opus.id}", json={"visibility": "members", "is_default": True}
    )
    assert both.status_code == 200
    defaults = [r["model_id"] for r in client.get("/api/admin/chat-models").json() if r["is_default"]]
    assert defaults == ["claude-opus-5-5"]
    assert db_session.query(AuditLog).filter_by(action="chat_model.updated").count() == 1


def test_an_admin_can_add_a_model_which_starts_closed(
    client: TestClient, db_session: Session, config
) -> None:
    response = client.post(
        "/api/admin/chat-models",
        json={
            "model_id": "claude-new-6",
            "label": "새 모델",
            "input_usd_per_mtok": "1.5",
            "output_usd_per_mtok": "7.5",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["visibility"] == "disabled"
    assert db_session.query(AuditLog).filter_by(action="chat_model.created").count() == 1

    duplicate = client.post(
        "/api/admin/chat-models",
        json={"model_id": "claude-new-6", "label": "x", "input_usd_per_mtok": "1", "output_usd_per_mtok": "1"},
    )
    assert duplicate.status_code == 400
    bad_id = client.post(
        "/api/admin/chat-models",
        json={"model_id": "Bad Model", "label": "x", "input_usd_per_mtok": "1", "output_usd_per_mtok": "1"},
    )
    assert bad_id.status_code == 400
    no_adapter = client.post(
        "/api/admin/chat-models",
        json={
            "provider": "gemini",
            "model_id": "gemini-x",
            "label": "x",
            "input_usd_per_mtok": "1",
            "output_usd_per_mtok": "1",
        },
    )
    assert no_adapter.status_code == 400
    assert "알 수 없는 제공자" in no_adapter.json()["detail"]


# ------------------------------------------------------------- providers (admin-and-nav-cleanup)


def test_providers_are_listed_anthropic_first(client: TestClient, config) -> None:
    providers = client.get("/api/admin/chat-models/providers").json()
    assert providers[0] == {"id": "anthropic", "label": "Anthropic (Claude)", "ready": True}
    deepseek = next(p for p in providers if p["id"] == "deepseek")
    assert deepseek["ready"] is False


def test_deepseek_is_seeded_closed_with_the_researchs_prices(
    client: TestClient, db_session: Session, config
) -> None:
    row = model(db_session, "deepseek/deepseek-v4.1-flash")
    assert row.provider == "deepseek"
    assert row.visibility is ChatModelVisibility.DISABLED
    assert (row.input_usd_per_mtok, row.output_usd_per_mtok) == (Decimal("0.30"), Decimal("1.20"))
    # The research's cache-read price — without it the tenth-of-input rule
    # would charge $0.03 instead of $0.006.
    assert row.cache_read_usd_per_mtok == Decimal("0.006")
    listed = next(r for r in client.get("/api/admin/chat-models").json() if r["id"] == row.id)
    assert listed["provider_ready"] is False
    assert listed["provider_label"].startswith("DeepSeek")
    # Never offered in the picker.
    offered = [m["model_id"] for m in client.get("/api/chat/info").json()["models"]]
    assert "deepseek/deepseek-v4.1-flash" not in offered


@pytest.mark.parametrize(
    "change",
    [{"visibility": "members"}, {"visibility": "admin"}, {"is_default": True}],
)
def test_a_model_of_a_provider_not_connected_cannot_be_opened_or_made_default(
    client: TestClient, db_session: Session, config, change
) -> None:
    row = model(db_session, "deepseek/deepseek-v4.1-flash")
    refused = client.patch(f"/api/admin/chat-models/{row.id}", json=change)
    assert refused.status_code == 400
    assert "연결 준비 중" in refused.json()["detail"]
    db_session.refresh(row)
    assert row.visibility is ChatModelVisibility.DISABLED and row.is_default is False
    # Its price may still be kept up to date.
    assert client.patch(
        f"/api/admin/chat-models/{row.id}", json={"input_usd_per_mtok": "0.35"}
    ).status_code == 200


def test_a_model_added_for_a_provider_not_connected_starts_and_stays_closed(
    client: TestClient, config
) -> None:
    body = {
        "provider": "deepseek",
        "model_id": "deepseek/deepseek-v4.1-pro",
        "label": "DeepSeek Pro",
        "input_usd_per_mtok": "1.32",
        "output_usd_per_mtok": "3.96",
    }
    opened = client.post("/api/admin/chat-models", json={**body, "visibility": "members"})
    assert opened.status_code == 400
    assert "연결 준비 중" in opened.json()["detail"]
    made = client.post("/api/admin/chat-models", json=body)
    assert made.status_code == 201, made.text
    assert made.json()["visibility"] == "disabled"


def test_a_stray_open_row_of_an_unknown_provider_can_be_priced_and_closed(
    client: TestClient, db_session: Session, config
) -> None:
    """Old data: a row whose provider has no adapter but which is open.

    The rule is "never *opened* or made the default", not "may not exist":
    its price may be edited while it stays open, it can be closed, and
    only re-opening is refused.
    """
    stray = ChatModel(
        provider="openrouter",
        model_id="stray/model",
        label="옛 행",
        description="",
        input_usd_per_mtok=Decimal("1"),
        output_usd_per_mtok=Decimal("2"),
        visibility=ChatModelVisibility.ADMIN,
        is_default=False,
        sort_order=90,
    )
    db_session.add(stray)
    db_session.commit()

    priced = client.patch(
        f"/api/admin/chat-models/{stray.id}", json={"input_usd_per_mtok": "1.10"}
    )
    assert priced.status_code == 200, priced.text
    assert priced.json()["visibility"] == "admin"

    closed = client.patch(f"/api/admin/chat-models/{stray.id}", json={"visibility": "disabled"})
    assert closed.status_code == 200, closed.text

    reopened = client.patch(f"/api/admin/chat-models/{stray.id}", json={"visibility": "admin"})
    assert reopened.status_code == 400
    assert "연결 준비 중" in reopened.json()["detail"]


def test_an_implausible_price_is_refused(client: TestClient, db_session: Session, config) -> None:
    sonnet = model(db_session, "claude-sonnet-5-5")
    assert client.patch(
        f"/api/admin/chat-models/{sonnet.id}", json={"input_usd_per_mtok": "0"}
    ).status_code == 422
