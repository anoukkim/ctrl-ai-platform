"""Cost calibration (cost-calibration, 2026-10-13).

The estimates made before a call learn from what the provider reported
afterwards. Checked with the mock and with ledger rows written directly —
nothing here reaches Anthropic.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import FundingSource, UsageEvent
from app.services import calibration, pricing
from app.services.chat import CHAT_SYSTEM_PROMPT
from app.services.chat_models import default_model


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0, chat_rate_limit_per_minute=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def _replies(db: Session, user_id: int, quarter_id: int, count: int, *, estimated: int,
             prompt: int, output: int = 300, charged: int = 9,
             model_id: str = "claude-sonnet-5-5") -> None:
    """`count` past Chat replies: estimated vs real prompt, and their cost."""
    for _ in range(count):
        db.add(
            UsageEvent(
                user_id=user_id,
                quarter_id=quarter_id,
                funding_source=FundingSource.COMMUNITY,
                provider="claude",
                feature="chat",
                model_id=model_id,
                input_tokens=prompt // 4,
                cache_read_tokens=prompt - prompt // 4,
                cache_write_tokens=0,
                output_tokens=output,
                estimated_input_tokens=estimated,
                charged_krw=charged,
            )
        )
    db.commit()


def test_each_reply_keeps_the_estimate_made_before_the_call(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    conversation = client.post("/api/chat/conversations", json={}).json()["id"]
    client.post(f"/api/chat/conversations/{conversation}/messages", json={"content": "안녕하세요"})

    event = db_session.query(UsageEvent).one()
    assert event.estimated_input_tokens > len(CHAT_SYSTEM_PROMPT)


def test_too_few_replies_and_the_formula_still_decides(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    _replies(db_session, dev_user.id, budgeted.quarter_id, 9, estimated=1_000, prompt=600)

    measured = calibration.for_model(db_session, "claude-sonnet-5-5")
    assert measured.samples == 9 and not measured.calibrated
    assert measured.input_factor == 1.0

    sonnet = next(m for m in client.get("/api/chat/info").json()["models"]
                  if m["model_id"] == "claude-sonnet-5-5")
    assert sonnet["estimate_basis"] == "formula"


def test_enough_replies_and_the_picker_shows_what_replies_really_cost(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    _replies(db_session, dev_user.id, budgeted.quarter_id, 12, estimated=1_000, prompt=600,
             charged=7)

    measured = calibration.for_model(db_session, "claude-sonnet-5-5")
    assert measured.calibrated
    assert measured.input_ratio == pytest.approx(0.6)
    assert measured.input_factor == pytest.approx(0.72)  # 0.6 × the 1.2 safety margin
    assert measured.median_reply_krw == 7
    assert measured.cache_hit_rate == pytest.approx(450 / 600)

    sonnet = next(m for m in client.get("/api/chat/info").json()["models"]
                  if m["model_id"] == "claude-sonnet-5-5")
    assert (sonnet["estimated_reply_krw"], sonnet["estimate_basis"], sonnet["estimate_samples"]) == (
        7, "recent", 12
    )
    # Haiku has no replies of its own, so it keeps the formula.
    haiku = next(m for m in client.get("/api/chat/info").json()["models"]
                 if m["model_id"] == "claude-haiku-4-5")
    assert haiku["estimate_basis"] == "formula"


def test_calibration_never_raises_the_input_estimate(
    db_session: Session, budgeted, dev_user
) -> None:
    _replies(db_session, dev_user.id, budgeted.quarter_id, 12, estimated=1_000, prompt=1_500)

    measured = calibration.for_model(db_session, "claude-sonnet-5-5")
    assert measured.input_ratio == pytest.approx(1.5)
    assert measured.input_factor == 1.0
    assert measured.calibrated_input(1_000) == 1_000


def test_the_pre_check_uses_the_calibrated_input_but_keeps_the_full_output(
    client: TestClient, db_session: Session, budgeted, dev_user, config
) -> None:
    """A wallet just short of the old worst case is refused before
    calibration and let through after — the output side is unchanged."""
    model = default_model(db_session, config)
    price = pricing.price_for(db_session, model, cache_ttl=config.cache_ttl)
    estimated = pricing.estimate_tokens(CHAT_SYSTEM_PROMPT) + pricing.estimate_tokens("안녕") + 4
    old = price.worst_case_krw(estimated, 8192)
    new = price.worst_case_krw(
        -(-estimated * 72 // 100), 8192
    )
    assert new < old
    budgeted.budget_krw = old - 1
    db_session.commit()

    conversation = client.post("/api/chat/conversations", json={}).json()["id"]
    refused = client.post(f"/api/chat/conversations/{conversation}/messages", json={"content": "안녕"})
    assert refused.status_code == 402

    _replies(db_session, dev_user.id, budgeted.quarter_id, 12, estimated=1_000, prompt=600,
             charged=0)
    allowed = client.post(f"/api/chat/conversations/{conversation}/messages", json={"content": "안녕"})
    assert allowed.status_code == 200, allowed.text


def test_admin_sees_the_calibration_per_model(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    _replies(db_session, dev_user.id, budgeted.quarter_id, 12, estimated=1_000, prompt=600,
             charged=7)

    rows = {row["model_id"]: row for row in client.get("/api/admin/chat-models/calibration").json()}
    sonnet = rows["claude-sonnet-5-5"]
    assert sonnet["calibrated"] is True and sonnet["samples"] == 12
    assert sonnet["median_reply_krw"] == 7
    assert sonnet["formula_reply_krw"] == pricing.typical_reply_krw(
        default_model(db_session, Settings()), pricing.current_rate(db_session)
    )
    assert Decimal(str(sonnet["input_factor"])) == Decimal("0.72")
    assert rows["claude-opus-5-5"]["samples"] == 0


def test_the_calibration_view_is_admin_only(other_client: TestClient) -> None:
    assert other_client.get("/api/admin/chat-models/calibration").status_code == 403
