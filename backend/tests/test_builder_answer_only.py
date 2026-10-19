"""builder-answer-only: a question in the Builder gets an answer, not a build.

The plan call decides. A question with no suggested change is `answered`
(charged for the plan only, nothing runs); with one it is `planned` and
waits for 적용하기, which runs exactly that plan. A new app is always built.

Mock Claude and a fake transport only; nothing reaches Anthropic.
"""

import json

import httpx2 as httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import builder as builder_route
from app.core.config import get_settings
from app.main import app
from app.models import BuilderGeneration, BuilderReference
from app.services import builder_stages
from app.services.claude_provider import AnthropicClaudeProvider
from tests.test_builder_references import picture, upload
from tests.test_builder_stages import charged, config, files_of, plan, project, run  # noqa: F401


def built(client: TestClient, project) -> None:
    run(client, project, plan(client, project, "할 일 앱").json()["id"])


def test_a_question_is_answered_and_nothing_is_built(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    built(client, project)
    before = files_of(db_session, project)
    spent = len(charged(db_session))

    response = plan(client, project, "빌드하지 말고 답만 해. 검색은 어디서 해?")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "answered" and body["kind"] == "edit"
    assert body["answer"] and body["plan"] == [] and body["summary"] == ""
    assert body["estimated_krw"] is None  # nothing to start
    # The plan call only: one charge, and the files did not move.
    assert len(charged(db_session)) == spent + 1 and body["charged_krw"] > 0
    assert files_of(db_session, project) == before
    # Not an open run, and it can never be started.
    assert client.get(f"/api/builder/projects/{project.id}/generation").json() is None
    refused = client.post(f"/api/builder/projects/{project.id}/generations/{body['id']}/run", json={})
    assert refused.status_code == 409


def test_a_question_with_a_suggestion_waits_for_apply_then_runs_that_plan(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    built(client, project)
    body = plan(client, project, "버튼 색을 바꾸면 어떨까?").json()
    assert body["status"] == "planned" and body["answer"]
    assert [step["path"] for step in body["plan"]] == ["style.css"]
    assert body["estimated_krw"] > 0
    # It waits: the open run is this plan, with its answer.
    open_run = client.get(f"/api/builder/projects/{project.id}/generation").json()
    assert open_run["id"] == body["id"] and open_run["answer"] == body["answer"]

    events = run(client, project, body["id"])  # 적용하기
    assert [data["path"] for name, data in events if name == "file_start"] == ["style.css"]
    assert db_session.get(BuilderGeneration, body["id"]).status == "done"


def test_an_answer_leaves_an_open_run_and_its_pictures_alone(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    built(client, project)
    waiting = plan(client, project, "버튼 색을 바꿔 줘").json()
    assert waiting["status"] == "planned" and waiting["answer"] == ""
    uploaded = upload(client, project, picture(400, 300))
    assert uploaded.status_code == 201, uploaded.text

    answered = plan(client, project, "이 앱은 어떻게 동작해?").json()
    assert answered["status"] == "answered"
    db_session.expire_all()
    assert db_session.get(BuilderGeneration, waiting["id"]).status == "planned"
    assert db_session.get(BuilderReference, uploaded.json()["id"]).generation_id is None
    assert client.get(f"/api/builder/projects/{project.id}/generation").json()["id"] == waiting["id"]


def test_a_suggestion_keeps_the_open_run_until_it_is_applied(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    built(client, project)
    waiting = plan(client, project, "버튼 색을 바꿔 줘").json()
    suggested = plan(client, project, "버튼 색을 바꾸면 어떨까?").json()
    assert suggested["status"] == "planned" and suggested["answer"]
    db_session.expire_all()
    # 괜찮아요 would give the open run back: it is still there.
    assert db_session.get(BuilderGeneration, waiting["id"]).status == "planned"

    run(client, project, suggested["id"])  # 적용하기 replaces it
    db_session.expire_all()
    assert db_session.get(BuilderGeneration, waiting["id"]).status == "cancelled"
    assert db_session.get(BuilderGeneration, suggested["id"]).status == "done"


def test_a_polite_request_is_a_change(client: TestClient, project, budgeted, config) -> None:
    built(client, project)
    body = plan(client, project, "버튼 색을 바꿔 줄래?").json()
    assert body["answer"] == "" and body["plan"]


def test_a_new_app_is_always_built_even_when_it_reads_like_a_question(
    client: TestClient, project, budgeted, config
) -> None:
    body = plan(client, project, "할 일 앱 만들어 줄래?").json()
    assert body["status"] == "planned" and body["kind"] == "create" and body["answer"] == ""


def test_a_change_still_starts_as_before(client: TestClient, project, budgeted, config) -> None:
    built(client, project)
    body = plan(client, project, "버튼 색을 바꿔 줘").json()
    assert body["status"] == "planned" and body["answer"] == "" and body["plan"]


# ------------------------------------------------------------ the real adapter


class FakeAnswer:
    def __init__(self, plan_json: dict) -> None:
        self.plan_json = plan_json
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
                "stop_reason": "end_turn", "stop_sequence": None,
                "content": [{"type": "text", "text": json.dumps(self.plan_json, ensure_ascii=False)}],
                "usage": {"input_tokens": 900, "output_tokens": 200},
            },
        )


def real(monkeypatch, config, plan_json: dict) -> FakeAnswer:
    settings = config.model_copy(
        update={"claude_provider": "anthropic", "anthropic_api_key": "test-not-a-real-key",
                "anthropic_model": "claude-sonnet-5-5"}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    fake = FakeAnswer(plan_json)
    monkeypatch.setattr(
        builder_route,
        "get_claude_provider",
        lambda _settings: AnthropicClaudeProvider(
            settings, http_client=httpx.Client(transport=httpx.MockTransport(fake.handler))
        ),
    )
    return fake


def test_the_real_plan_returns_an_answer(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    built(client, project)
    fake = real(monkeypatch, config, {
        "kind": "question", "answer": "검색은 search.js가 해요.", "summary": "", "files": [],
    })
    body = plan(client, project, "검색은 어디서 해").json()
    assert body["status"] == "answered" and body["answer"] == "검색은 search.js가 해요."
    [sent] = fake.requests
    # Room for a whole answer on an app that exists; a new app keeps the small plan.
    assert sent["max_tokens"] == builder_stages.ANSWER_PLAN_MAX_TOKENS
    assert "question" in sent["output_config"]["format"]["schema"]["properties"]["kind"]["enum"]
    assert '"question"' in sent["system"]


def test_a_question_without_an_answer_is_free_and_refused(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    built(client, project)
    real(monkeypatch, config, {"kind": "question", "answer": "  ", "summary": "", "files": []})
    spent = sum(charged(db_session))
    refused = plan(client, project, "검색은 어디서 해")
    assert refused.status_code == 502
    assert sum(charged(db_session)) == spent  # the club absorbed it
