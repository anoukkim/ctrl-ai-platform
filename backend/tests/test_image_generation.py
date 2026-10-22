"""image-generation — 이미지 만들기 in Chat, against the mock image provider.

What is proved: a reply offers the card with its description and the
marker never shows; one press makes a picture, charges the catalogue's
price for the size once (with the provider's USD on the event), and the
picture sits on the reply as a downloadable file only its owner can read;
sizes, ratios and models outside the catalogue are refused before the
provider is asked; a refusal, a failure and an empty wallet cost nothing
and store nothing; the area stays locked for members until it is opened;
a made picture is never sent back to Claude; the Gemini adapter's request
and parser; the startup guard on an unbilled key; the admin catalogue is
validated and audited.
"""

import base64
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import AuditLog, ChatAttachment, ChatMessage, ImageModel, UsageEvent
from app.models.chat import ChatAction, ChatRole
from app.services import chat as chat_service
from app.services import image_provider
from app.services.image_provider import (
    GeminiImageProvider,
    ImageRefusedError,
    ImageRequest,
    MockImageProvider,
    ProviderUnavailableError,
    parse_gemini,
)


@pytest.fixture
def settings(tmp_path):
    value = Settings(app_env="development", storage_dir=str(tmp_path / "storage"), chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: value
    yield value
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def image_models(db_session: Session) -> list[ImageModel]:
    from app.db.init_db import seed_image_models

    seed_image_models(db_session)
    return list(db_session.scalars(select(ImageModel).order_by(ImageModel.sort_order)))


@pytest.fixture(autouse=True)
def fresh_mock_calls():
    MockImageProvider.calls.clear()
    yield
    MockImageProvider.calls.clear()


def offer(client: TestClient, text: str = "우리 동아리 고양이 그림 그려줘") -> dict:
    """Start a conversation, ask for a picture, return the reply that offers the card."""
    conversation = client.post("/api/chat/conversations", json={}).json()["id"]
    sent = client.post(f"/api/chat/conversations/{conversation}/messages", json={"content": text})
    assert sent.status_code == 200, sent.text
    detail = client.get(f"/api/chat/conversations/{conversation}").json()
    reply = detail["messages"][-1]
    assert reply["role"] == "assistant"
    return reply | {"conversation_id": conversation}


def make(client: TestClient, message_id: int, **body):
    return client.post(
        f"/api/chat/messages/{message_id}/images", json={"prompt": "a calm orange cat on a desk"} | body
    )


def charges(db: Session) -> list[UsageEvent]:
    return list(db.scalars(select(UsageEvent).where(UsageEvent.feature == "image_generate")))


# ------------------------------------------------------------- the card


def test_a_picture_request_offers_the_card_with_a_description(
    client: TestClient, budgeted, settings, image_models
) -> None:
    reply = offer(client)
    assert reply["action"] == "image"
    assert "A friendly illustration of:" in reply["action_prompt"]
    assert "[[action" not in reply["content"]
    assert reply["action_title"] == ""


def test_the_marker_is_held_back_while_streaming_and_parsed_whole() -> None:
    marker = chat_service.MarkerFilter()
    shown = marker.feed("좋아요!\n[[action:im")
    shown += marker.feed("age|A watercolor fox, soft light]]")
    shown += marker.finish()
    assert shown == "좋아요!\n"
    action, title, prompt = chat_service.action_of(marker.raw)
    assert action is ChatAction.IMAGE and title == "" and prompt == "A watercolor fox, soft light"


def test_the_card_lists_only_member_visible_models(client: TestClient, settings, image_models) -> None:
    listed = client.get("/api/chat/image-models").json()
    assert [m["model_id"] for m in listed["models"]] == ["gemini-nano-banana-2.1"]
    assert listed["mock"] is True
    assert listed["open"] is True  # the dev user is the admin


# ------------------------------------------------------------- making one


def test_one_press_makes_a_picture_charges_once_and_stores_it(
    client: TestClient, budgeted, settings, image_models, db_session: Session
) -> None:
    reply = offer(client)
    response = make(client, reply["id"], size="2K", aspect_ratio="16:9")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["charged_krw"] == 75
    attachment = body["attachment"]
    assert attachment["generated_model"] == "gemini-nano-banana-2.1"
    assert attachment["message_id"] == reply["id"]
    assert (attachment["width"], attachment["height"]) == (2048, 1152)

    [event] = charges(db_session)
    assert event.charged_krw == 75
    assert event.provider == "gemini"
    assert float(event.provider_cost) == pytest.approx(0.0504)
    assert event.provider_units == 1 and event.provider_unit == "images"
    assert event.conversation_id == reply["conversation_id"]

    file = client.get(f"/api/chat/attachments/{attachment['id']}/file")
    assert file.status_code == 200 and file.headers["content-type"] == "image/png"
    Image.open(io.BytesIO(file.content)).verify()
    download = client.get(f"/api/chat/attachments/{attachment['id']}/file", params={"download": "true"})
    assert "attachment" in download.headers["content-disposition"]

    detail = client.get(f"/api/chat/conversations/{reply['conversation_id']}").json()
    assert [a["id"] for a in detail["messages"][-1]["attachments"]] == [attachment["id"]]


def test_defaults_come_from_the_catalogue(client: TestClient, budgeted, settings, image_models) -> None:
    reply = offer(client)
    body = make(client, reply["id"]).json()
    assert body["charged_krw"] == 50
    assert (body["attachment"]["width"], body["attachment"]["height"]) == (1024, 1024)


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"size": "8K"}, "8K 크기를 지원하지 않습니다"),
        ({"aspect_ratio": "21:9"}, "21:9 비율을 지원하지 않습니다"),
    ],
)
def test_settings_outside_the_catalogue_are_refused_before_the_provider(
    client: TestClient, budgeted, settings, image_models, db_session: Session, body, message
) -> None:
    reply = offer(client)
    response = make(client, reply["id"], **body)
    assert response.status_code == 400 and message in response.json()["detail"]
    assert MockImageProvider.calls == [] and charges(db_session) == []


def test_hidden_and_disabled_models_are_refused(
    client: TestClient, budgeted, settings, image_models, db_session: Session
) -> None:
    default, pro = image_models
    reply = offer(client)
    assert make(client, reply["id"], model=pro.id).status_code == 400  # not member-visible
    default.enabled = False
    db_session.commit()
    response = make(client, reply["id"], model=default.id)
    assert response.status_code == 400
    assert make(client, reply["id"]).json()["detail"].startswith("사용할 수 있는 이미지 모델이 없습니다")
    assert MockImageProvider.calls == [] and charges(db_session) == []


@pytest.mark.parametrize(("word", "status"), [("MOCK_REFUSE", 422), ("MOCK_FAIL", 503)])
def test_a_refusal_or_a_failure_costs_nothing_and_stores_nothing(
    client: TestClient, budgeted, settings, image_models, db_session: Session, word, status
) -> None:
    reply = offer(client)
    response = make(client, reply["id"], prompt=f"a cat {word}")
    assert response.status_code == status
    assert "돈은 빠져나가지 않았어요" in response.json()["detail"]
    assert charges(db_session) == []
    assert db_session.scalars(select(ChatAttachment)).all() == []


def test_an_empty_wallet_is_refused_before_the_provider(
    client: TestClient, budgeted, settings, image_models, db_session: Session
) -> None:
    reply = offer(client)
    budgeted.budget_krw = 0
    db_session.commit()
    response = make(client, reply["id"])
    assert response.status_code == 402
    assert MockImageProvider.calls == [] and charges(db_session) == []


def test_only_a_reply_that_offered_the_card_can_make_one(
    client: TestClient, budgeted, settings, image_models, db_session: Session
) -> None:
    reply = offer(client, "안녕하세요")
    assert reply["action"] is None
    assert make(client, reply["id"]).status_code == 400
    question = db_session.scalar(select(ChatMessage).where(ChatMessage.role == ChatRole.USER))
    assert make(client, question.id).status_code == 400
    assert make(client, 999_999).status_code == 404


def test_another_members_reply_and_picture_are_a_404(
    client: TestClient,
    budgeted,
    settings,
    image_models,
    db_session: Session,
    other_user,
    other_participating,
) -> None:
    reply = offer(client)
    attachment = make(client, reply["id"]).json()["attachment"]
    client.post("/api/auth/logout", json={})
    from tests.conftest import MEMBER_PASSWORD

    client.post("/api/auth/login", json={"username": "other", "password": MEMBER_PASSWORD})
    from app.services import feature_switches
    from app.models import User

    admin = db_session.scalar(select(User).where(User.username != "other"))
    feature_switches.set_open(db_session, admin, feature_switches.IMAGE, True, "test")
    db_session.commit()
    assert make(client, reply["id"]).status_code == 404
    assert client.get(f"/api/chat/attachments/{attachment['id']}/file").status_code == 404


def test_a_price_changed_since_the_card_loaded_makes_nothing(
    client: TestClient, budgeted, settings, image_models, db_session: Session
) -> None:
    reply = offer(client)
    stale = make(client, reply["id"], expected_krw=40)
    assert stale.status_code == 409 and "지금은 한 장에 50원" in stale.json()["detail"]
    assert MockImageProvider.calls == [] and charges(db_session) == []
    assert make(client, reply["id"], expected_krw=50).status_code == 201


def test_a_conversation_deleted_while_drawing_costs_nothing(
    client: TestClient, budgeted, settings, image_models, db_session: Session, monkeypatch
) -> None:
    reply = offer(client)
    real = MockImageProvider.generate

    def delete_first(self, request):
        from app.models import Conversation

        db_session.query(Conversation).filter_by(id=reply["conversation_id"]).delete()
        db_session.commit()
        return real(self, request)

    monkeypatch.setattr(MockImageProvider, "generate", delete_first)
    response = make(client, reply["id"])
    assert response.status_code == 404 and "돈은 빠져나가지 않았어요" in response.json()["detail"]
    assert charges(db_session) == []


def test_one_card_makes_at_most_ten(
    client: TestClient, budgeted, settings, image_models, db_session: Session, monkeypatch
) -> None:
    from app.api.routes import images

    monkeypatch.setattr(images, "MAX_IMAGES_PER_CARD", 2)
    reply = offer(client)
    assert make(client, reply["id"]).status_code == 201
    assert make(client, reply["id"]).status_code == 201
    third = make(client, reply["id"])
    assert third.status_code == 409 and "2장까지" in third.json()["detail"]
    assert len(charges(db_session)) == 2


# ------------------------------------------------------------- the lock


def test_members_are_locked_out_until_the_admin_opens_it(
    anon_client: TestClient,
    settings,
    image_models,
    db_session: Session,
    dev_user,
    other_user,
    other_participating,
) -> None:
    from app.models import QuarterAllocation
    from app.services import feature_switches
    from tests.conftest import MEMBER_PASSWORD

    db_session.add(QuarterAllocation(user_id=other_user.id, quarter_id=other_participating.id, budget_krw=10_000))
    db_session.commit()
    anon_client.post("/api/auth/login", json={"username": "other", "password": MEMBER_PASSWORD})
    assert anon_client.get("/api/chat/image-models").json()["open"] is False
    reply = offer(anon_client)
    locked = make(anon_client, reply["id"])
    assert locked.status_code == 403 and "이미지 만들기는 다음 단계에서 열려요" in locked.json()["detail"]
    assert MockImageProvider.calls == []

    feature_switches.set_open(db_session, dev_user, feature_switches.IMAGE, True, "test")
    db_session.commit()
    assert make(anon_client, reply["id"]).status_code == 201


# ------------------------------------------------------------- never sent back


def test_a_made_picture_is_never_sent_back_to_claude(
    client: TestClient, budgeted, settings, image_models, monkeypatch
) -> None:
    from app.services.claude_provider import MockClaudeProvider

    captured: list = []
    real = MockClaudeProvider.stream_chat

    def spy(self, request):
        captured.append(request.messages)
        return real(self, request)

    monkeypatch.setattr(MockClaudeProvider, "stream_chat", spy)
    reply = offer(client)
    assert make(client, reply["id"]).status_code == 201
    client.post(f"/api/chat/conversations/{reply['conversation_id']}/messages", json={"content": "고마워"})
    sent = json.dumps(captured[-1], ensure_ascii=False, default=str)
    assert '"image"' not in sent


# ------------------------------------------------------------- the Gemini adapter


class FakeResponse:
    def __init__(self, status_code: int, payload: object) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def png_bytes() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (16, 9), (10, 20, 30)).save(out, format="PNG")
    return out.getvalue()


def test_gemini_request_shape_and_answer() -> None:
    seen: dict = {}

    def post(url, json, headers, timeout):
        seen.update(url=url, json=json, headers=headers)
        return FakeResponse(
            200,
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "Here you go"},
                                {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(png_bytes()).decode()}},
                            ]
                        },
                        "finishReason": "STOP",
                    }
                ],
                "responseId": "resp-1",
            },
        )

    result = GeminiImageProvider("test-key", post=post).generate(
        ImageRequest(model_id="gemini-nano-banana-2.1", prompt="a fox", size="2K", aspect_ratio="16:9")
    )
    assert result.data == png_bytes() and result.media_type == "image/png" and result.job_id == "resp-1"
    assert seen["url"].endswith("/models/gemini-nano-banana-2.1:generateContent")
    assert seen["headers"] == {"x-goog-api-key": "test-key"}
    assert seen["json"]["generationConfig"] == {
        "responseModalities": ["IMAGE"],
        "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"},
    }


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        ({"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}}, ImageRefusedError),
        ({"candidates": [{"finishReason": "IMAGE_SAFETY", "content": {"parts": []}}]}, ImageRefusedError),
        ({"candidates": [{"content": {"parts": [{"text": "no picture"}]}, "finishReason": "STOP"}]}, ProviderUnavailableError),
        ({"candidates": [{"content": {"parts": [{"inlineData": {"data": "not base64!"}}]}}]}, ProviderUnavailableError),
        ("nonsense", ProviderUnavailableError),
    ],
)
def test_gemini_refusals_and_misses(payload, error) -> None:
    with pytest.raises(error):
        parse_gemini(payload)


def test_gemini_http_errors_and_transport_failures_are_unavailable() -> None:
    request = ImageRequest(model_id="m", prompt="p", size="1K", aspect_ratio="1:1")
    with pytest.raises(ProviderUnavailableError):
        GeminiImageProvider("k", post=lambda *a, **k: FakeResponse(429, {})).generate(request)

    def boom(*a, **k):
        raise ConnectionError("down")

    with pytest.raises(ProviderUnavailableError):
        GeminiImageProvider("k", post=boom).generate(request)


def test_startup_refuses_gemini_without_a_key_or_the_billing_confirmation() -> None:
    missing = Settings(app_env="development", image_provider="gemini").missing_provider_settings()
    assert "GEMINI_API_KEY" in missing
    assert any(item.startswith("GEMINI_BILLING_CONFIRMED") for item in missing)
    ready = Settings(
        app_env="development", image_provider="gemini", gemini_api_key="k", gemini_billing_confirmed=True
    )
    assert not any("GEMINI" in item or "IMAGE" in item for item in ready.missing_provider_settings())
    assert Settings(app_env="development").missing_provider_settings() == [] or all(
        "GEMINI" not in item for item in Settings(app_env="development").missing_provider_settings()
    )
    assert isinstance(image_provider.get_image_provider(ready), GeminiImageProvider)


# ------------------------------------------------------------- admin catalogue


def test_admin_edits_are_validated_and_audited(
    client: TestClient, settings, image_models, db_session: Session
) -> None:
    default = image_models[0]
    listed = client.get("/api/admin/image-models").json()
    assert {m["model_id"] for m in listed} == {"gemini-nano-banana-2.1", "gemini-3-pro-image"}

    caps = dict(default.capabilities)
    bad = client.patch(
        f"/api/admin/image-models/{default.id}",
        json={"capabilities": caps | {"price_per_image_krw": {"1K": 50, "2K": 75}}},
    )
    assert bad.status_code == 400 and "크기마다 한 장 가격이 있어야 합니다" in bad.json()["detail"]

    good = client.patch(
        f"/api/admin/image-models/{default.id}",
        json={"capabilities": caps | {"price_per_image_krw": {"1K": 60, "2K": 90, "4K": 200}}},
    )
    assert good.status_code == 200, good.text
    assert good.json()["capabilities"]["prices_are_examples"] is False
    assert good.json()["capabilities"]["price_per_image_krw"]["1K"] == 60

    hidden = client.patch(f"/api/admin/image-models/{default.id}", json={"enabled": False})
    assert hidden.json()["member_visible"] is False
    actions = [row.action for row in db_session.scalars(select(AuditLog))]
    assert actions.count("image_model.updated") == 2
