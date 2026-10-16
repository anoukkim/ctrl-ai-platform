"""app-platform P4b — the price before the button, and never more than it.

`ctrlai.ai.estimate` is free and open signed out; a call made with the
same options — the JSON retry included — never charges more than the
`maxKrw` it showed. Opening an app in LIVE mode spends nothing (the
showcase tests in the Playwright spec cover the browser side).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import BuilderProject, UsageEvent
from app.services import app_ai
from tests.test_app_platform_p2 import config, headers, shop, sign_in  # noqa: F401 — fixtures
from tests.test_app_platform_p3 import stranger, visitor_b  # noqa: F401 — fixtures

pytestmark = pytest.mark.usefixtures("config")

SCHEMA = {
    "type": "object",
    "required": ["shop", "total"],
    "properties": {"shop": {"type": "string"}, "total": {"type": "integer", "minimum": 0}},
    "additionalProperties": False,
}


def estimate(client: TestClient, project: BuilderProject, **body) -> dict:
    response = client.post("/_ctrlai/v1/ai/estimate", headers=headers(project), json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_estimate_is_free_open_signed_out_and_counts_images_at_their_bound(
    stranger: TestClient, client: TestClient, db_session: Session, shop: BuilderProject
) -> None:
    plain = estimate(stranger, shop, prompt="영수증을 읽어 줘", json=SCHEMA, maxTokens=600)
    assert set(plain) == {"typicalKrw", "maxKrw", "model"} and plain["model"] == "fast"
    assert 1 <= plain["typicalKrw"] <= plain["maxKrw"] <= app_ai.CALL_CAP_KRW
    with_photo = estimate(stranger, shop, prompt="영수증을 읽어 줘", json=SCHEMA, maxTokens=600, images=1)
    assert with_photo["maxKrw"] > plain["maxKrw"]
    # Only a count: the SDK turns data URLs into one, and this free route reads no file.
    tiny = "data:image/png;base64,iVBORw0KGgo="
    assert client.post("/_ctrlai/v1/ai/estimate", headers=headers(shop), json={"images": [tiny]}).status_code == 422
    smart = estimate(stranger, shop, prompt="영수증을 읽어 줘", model="smart")
    assert smart["model"] == "smart" and smart["typicalKrw"] > plain["typicalKrw"]
    assert client.post("/_ctrlai/v1/ai/estimate", headers=headers(shop), json={"images": 5}).status_code == 422
    assert db_session.query(UsageEvent).count() == 0  # nothing charged, nothing sent

    client.post(f"/api/admin/apps/{shop.id}/sdk", json={"enabled": False, "reason": "확인 중"})
    assert client.post("/_ctrlai/v1/ai/estimate", headers=headers(shop), json={}).status_code == 403


def test_a_call_never_costs_more_than_the_estimate_shown_retry_included(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted
) -> None:
    sign_in(client, shop)
    options = {"prompt": "MOCK_BAD_JSON 영수증을 읽어 줘", "json": SCHEMA, "maxTokens": 400}
    shown = estimate(client, shop, **options)

    # The first answer breaks the schema; the retry fits inside the figure shown.
    retried = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json=options)
    assert retried.status_code == 200 and retried.json()["json"] == {"shop": "예시", "total": 0}
    assert 0 < retried.json()["chargedKrw"] <= shown["maxKrw"]
    event = db_session.query(UsageEvent).one()
    assert event.charged_krw == retried.json()["chargedKrw"]  # one ledger row, retry included

    # Both answers wrong: still at most the figure shown, and the club is not out of pocket beyond it.
    options["prompt"] = "MOCK_ALWAYS_BAD_JSON 영수증을 읽어 줘"
    shown = estimate(client, shop, **options)
    failed = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json=options)
    assert failed.status_code == 502
    charged = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first().charged_krw
    assert 0 < charged <= shown["maxKrw"]


def test_the_retry_is_held_inside_the_first_attempt_s_worst_case(
    db_session: Session, shop: BuilderProject, dev_user, budgeted, config
) -> None:
    data = app_ai.AskInput(prompt="읽어 줘", schema=SCHEMA, max_tokens=2000)
    first = app_ai.prepare(db_session, config, user=dev_user, project=shop, data=data)
    assert first.max_krw == first.price.worst_case_krw(first.input_estimate, first.request.max_tokens) <= app_ai.CALL_CAP_KRW
    # The figure `estimate` shows for the same options is at least the real attempt's cap.
    assert app_ai.estimate(db_session, config, data, 0).max_krw >= first.max_krw

    # Whatever the first attempt spent, the retry's own ceiling is the first
    # figure, with a smaller output budget — until nothing is left, when it is
    # refused before any provider call, as bad_json.
    longer = [*first.request.messages, {"role": "assistant", "content": "x"}, {"role": "user", "content": "again"}]
    refused_at = None
    for spent in range(0, first.max_krw + 1):
        try:
            retry = app_ai.prepare(
                db_session, config, user=dev_user, project=shop, data=data, spent_krw=spent, messages=longer,
                cap_krw=first.max_krw,
            )
        except app_ai.AppAIError as error:
            assert error.code == "bad_json"
            refused_at = spent
            break
        assert retry.max_krw == first.max_krw and retry.request.max_tokens <= first.request.max_tokens
    assert refused_at is not None and refused_at <= first.max_krw


def test_the_sdk_and_shell_carry_estimate() -> None:
    from app.services import app_shell

    sdk = app_shell.static_file("sdk.js")
    assert "estimate: function" in sdk and 'version: "5"' in sdk
    assert 'case "ai.estimate"' in app_shell.static_file("shell.js")


# ------------------------------------------------------------ Admin › Apps


def test_admin_apps_overview_lists_used_apps_with_ai_consents_and_data(
    client: TestClient, visitor_b: TestClient, db_session: Session, shop: BuilderProject, budgeted, dev_user, other_user, config
) -> None:
    from app.services import app_runtime
    from tests.test_app_platform_p4 import sign_in_preview

    # A visitor's call on the published app, and the maker's try in the preview.
    sign_in(client, shop)
    assert client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕?"}).status_code == 200
    draft = BuilderProject(owner_user_id=dev_user.id, name="내 초안", description="")
    db_session.add(draft)
    db_session.flush()
    app_runtime.write_draft(db_session, config, draft, {"index.html": "<!doctype html><head></head>"})
    db_session.commit()
    preview = sign_in_preview(client, draft)
    assert client.post("/_ctrlai/v1/ai/ask", headers=preview, json={"prompt": "안녕?"}).status_code == 200
    # An untouched, unpublished project stays out of the list.
    db_session.add(BuilderProject(owner_user_id=dev_user.id, name="손 안 댄 초안", description=""))
    db_session.commit()

    rows = {row["name"]: row for row in client.get("/api/admin/apps/overview").json()}
    assert set(rows) == {"내 초안", "영수증 읽기"}
    mine, theirs = rows["내 초안"], rows["영수증 읽기"]
    assert mine["published"] is False and mine["slug"] is None and mine["consents"] == 1
    assert mine["ai"]["quarter_calls"] == 0 and mine["ai"]["preview_quarter_calls"] == 1 and mine["ai"]["preview_quarter_krw"] > 0
    assert theirs["published"] is True and theirs["slug"] == shop.app_slug and theirs["owner_username"] == "other"
    assert theirs["ai"]["today_calls"] == 1 and theirs["ai"]["quarter_calls"] == 1 and theirs["ai"]["today_krw"] == theirs["ai"]["quarter_krw"] > 0
    assert theirs["consents"] == 1 and theirs["data_items"] == 0 and theirs["sdk_enabled"] is True

    one = client.get(f"/api/admin/apps/{shop.id}").json()
    assert one["name"] == "영수증 읽기" and one["ai"] == theirs["ai"]
    assert client.get("/api/admin/apps/999").status_code == 404
    assert visitor_b.get("/api/admin/apps/overview").status_code == 403
    assert visitor_b.get(f"/api/admin/apps/{shop.id}").status_code == 403
