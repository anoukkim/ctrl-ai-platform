"""Project Builder's 예시 앱 (chat-builder-starter, 2026-10-13).

Mock Claude and a fake transport only — nothing reaches Anthropic.
"""

import json
from decimal import Decimal

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import builder as builder_route
from app.core.config import Settings, get_settings
from app.main import app
from app.models import BuilderProject, BuilderProjectFile, MembershipStatus, UsageEvent
from app.services.builder_starter import StarterError, check_files
from app.services.claude_provider import AnthropicClaudeProvider, MockClaudeProvider
from app.services.quarters import set_membership


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def project(db_session: Session, dev_user) -> BuilderProject:
    row = BuilderProject(owner_user_id=dev_user.id, name="가계부", description="한 달 지출을 적는 앱")
    db_session.add(row)
    db_session.commit()
    return row


def starter(client: TestClient, project: BuilderProject, idea: str = ""):
    return client.post(f"/api/builder/projects/{project.id}/starter", json={"idea": idea})


# ------------------------------------------------------------ the happy path


def test_a_starter_app_is_stored_and_charged_to_the_wallet(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    response = starter(client, project)

    assert response.status_code == 201, response.text
    body = response.json()
    assert [f["path"] for f in body["files"]] == ["index.html", "style.css", "app.js"]
    assert "가계부" in body["files"][0]["content"]
    assert body["summary"]

    event = db_session.query(UsageEvent).one()
    assert (event.provider, event.feature, event.builder_project_id) == ("claude", "build", project.id)
    assert event.charged_krw == body["charged_krw"] > 0
    db_session.refresh(budgeted)
    assert budgeted.consumed_krw == event.charged_krw

    listed = client.get(f"/api/builder/projects/{project.id}/files").json()
    assert {f["path"] for f in listed} == {"index.html", "style.css", "app.js"}


def test_the_estimate_is_shown_before_anything_is_spent(
    client: TestClient, db_session: Session, budgeted, config
) -> None:
    body = client.get("/api/builder/starter-estimate").json()
    assert 0 < body["estimated_krw"] < body["worst_case_krw"]
    assert body["model_label"]
    assert db_session.query(UsageEvent).count() == 0


# ------------------------------------------------------------ refusals


def test_a_short_wallet_is_refused_before_claude_is_called(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    calls = []
    original = MockClaudeProvider.generate_starter_app
    monkeypatch.setattr(
        MockClaudeProvider,
        "generate_starter_app",
        lambda self, *a, **k: calls.append(1) or original(self, *a, **k),
    )
    budgeted.budget_krw = 5
    db_session.commit()

    response = starter(client, project)

    assert response.status_code == 402
    assert calls == []
    assert db_session.query(BuilderProjectFile).count() == 0
    assert db_session.query(UsageEvent).count() == 0


def test_a_project_with_files_is_never_overwritten(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    db_session.add(BuilderProjectFile(project_id=project.id, path="index.html", content="내 작업"))
    db_session.commit()

    response = starter(client, project)

    assert response.status_code == 409
    assert db_session.query(BuilderProjectFile).one().content == "내 작업"
    assert db_session.query(UsageEvent).count() == 0


def test_a_failed_call_is_free_and_stores_nothing(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    response = starter(client, project, "[mock-error:unavailable]")

    assert response.status_code == 503
    assert db_session.query(BuilderProjectFile).count() == 0
    assert db_session.query(UsageEvent).count() == 0


def test_a_member_not_participating_cannot_make_one(
    client: TestClient, db_session: Session, project, budgeted, dev_user, config
) -> None:
    set_membership(db_session, dev_user.id, budgeted.quarter_id, MembershipStatus.INACTIVE)
    db_session.commit()

    assert starter(client, project).status_code == 403
    # Reading stays open.
    assert client.get(f"/api/builder/projects/{project.id}/files").status_code == 200


def test_another_members_project_is_not_found(
    other_client: TestClient, db_session: Session, project, other_participating, config
) -> None:
    assert starter(other_client, project).status_code == 404
    assert other_client.get(f"/api/builder/projects/{project.id}/files").status_code == 404


# ------------------------------------------------------------ the file check


@pytest.mark.parametrize(
    "path",
    ["../escape.js", "/etc/passwd.txt", ".env", "server.py", "run.sh", "a/b/c.js", "index.php",
     "dir/.hidden.js"],
)
def test_anything_but_static_text_files_is_refused(path: str) -> None:
    with pytest.raises(StarterError):
        check_files([("index.html", "<p>hi</p>"), (path, "x")])


def test_index_html_is_required_and_sizes_are_capped() -> None:
    with pytest.raises(StarterError):
        check_files([("app.js", "1")])
    with pytest.raises(StarterError):
        check_files([("index.html", "x" * 100_001)])
    with pytest.raises(StarterError):
        check_files([("index.html", "x")] + [(f"f{i}.js", "x") for i in range(10)])
    assert check_files([("./index.html", "a"), ("js/app.js", "b"), ("index.html", "c")]) == [
        ("index.html", "a"),
        ("js/app.js", "b"),
    ]


# ------------------------------------------------------------ the real adapter


class FakeMessages:
    """Answers `POST /v1/messages` locally with a structured-output reply."""

    def __init__(self, stop_reason: str = "end_turn") -> None:
        self.stop_reason = stop_reason
        self.requests: list[httpx.Request] = []
        self.status = 200
        self.files = [
            {"path": "index.html", "content": "<!doctype html><title>할 일</title>"},
            {"path": "app.js", "content": "console.log('안녕')"},
        ]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(
                self.status,
                json={"type": "error", "error": {"type": "api_error", "message": "boom"}},
            )
        payload = {
            "summary": "할 일 앱의 첫 버전이에요. 다음엔 날짜를 붙여 달라고 해 보세요.",
            "files": self.files,
        }
        return httpx.Response(
            200,
            json={
                "id": "msg_test", "type": "message", "role": "assistant",
                "model": "claude-sonnet-5-5", "stop_reason": self.stop_reason,
                "stop_sequence": None,
                "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
                "usage": {"input_tokens": 900, "output_tokens": 2_000},
            },
        )


@pytest.fixture
def real_claude(monkeypatch, config):
    settings = Settings(
        app_env="development", claude_provider="anthropic",
        anthropic_api_key="test-not-a-real-key", anthropic_model="claude-sonnet-5-5",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    fake = FakeMessages()
    monkeypatch.setattr(
        builder_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, http_client=httpx.Client(transport=httpx.MockTransport(fake.handler))
        ),
    )
    return fake


def test_the_real_adapter_asks_for_structured_files_and_charges_the_tokens(
    client: TestClient, db_session: Session, project, budgeted, real_claude
) -> None:
    response = starter(client, project, "할 일 앱")

    assert response.status_code == 201, response.text
    body = json.loads(real_claude.requests[0].content)
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["max_tokens"] == 16000
    assert "cache_control" not in body, "one-off requests are not cached"
    assert "starter web apps" in body["system"]

    assert [f["path"] for f in response.json()["files"]] == ["index.html", "app.js"]
    event = db_session.query(UsageEvent).one()
    assert (event.input_tokens, event.output_tokens) == (900, 2_000)


def _absorbed_only(db_session: Session, budgeted) -> UsageEvent:
    """Nothing charged to the member; the club's cost recorded once."""
    event = db_session.query(UsageEvent).one()
    assert event.charged_krw == 0 and event.club_absorbed is True
    # 900 input × $2 + 2,000 output × $10, per million tokens (Sonnet 5.5).
    assert event.provider_cost == Decimal("0.021800")
    assert event.input_cost_usd + event.output_cost_usd == event.provider_cost
    db_session.refresh(budgeted)
    assert budgeted.consumed_krw == 0
    return event


@pytest.mark.parametrize("stop_reason", ["max_tokens", "refusal"])
def test_a_cut_off_or_refused_app_is_not_stored_or_charged_but_the_club_cost_is_recorded(
    client: TestClient, db_session: Session, project, budgeted, real_claude, stop_reason
) -> None:
    """cost-clarity audit: the provider billed it, so Admin › Budget must see it."""
    real_claude.stop_reason = stop_reason

    assert starter(client, project).status_code == 503
    assert db_session.query(BuilderProjectFile).count() == 0
    _absorbed_only(db_session, budgeted)
    # Not a charge on the member's own Usage screen.
    assert client.get("/api/usage/me").json()["events"] == []


def test_unusable_files_are_not_stored_or_charged_but_the_club_cost_is_recorded(
    client: TestClient, db_session: Session, project, budgeted, real_claude
) -> None:
    real_claude.files = [{"path": "server.py", "content": "print('no')"}]

    # The route answers a StarterError after the call with 502 (an answer
    # Claude gave that we cannot use), as it did before cost-clarity.
    assert starter(client, project).status_code == 502
    assert db_session.query(BuilderProjectFile).count() == 0
    _absorbed_only(db_session, budgeted)


def test_a_provider_error_records_nothing(
    client: TestClient, db_session: Session, project, budgeted, real_claude
) -> None:
    """A call the provider refused cost nothing: no absorbed row either."""
    real_claude.status = 500

    assert starter(client, project).status_code == 503
    assert db_session.query(UsageEvent).count() == 0
