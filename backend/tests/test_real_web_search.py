"""fix-real-web-search — the real adapter's server-tool path.

Built from the event shapes in the API docs (platform.claude.com › web
search, web fetch, server tools; checked 2026-10-14) and answered by a
local fake transport. No request leaves the machine.
"""

import json

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import builder as builder_route
from app.api.routes import chat as chat_route
from app.models import BuilderProject, BuilderProjectFile, ChatMessage, ChatRole, UsageEvent
from app.services.claude_provider import (
    CHAT_SYSTEM_PROMPT,
    AnthropicClaudeProvider,
    MockClaudeProvider,
    SourceList,
)
from tests.test_chat import config, events_of, new_conversation, reply_text, send, use_settings  # noqa: F401
from tests.test_chat_tools import open_tools, turn_on

SECRET = "test-not-a-real-key"


def sse(events: list[tuple[str, dict]]) -> bytes:
    return "".join(
        f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n" for name, data in events
    ).encode()


def start(input_tokens: int = 500, cache_write: int = 0, cache_read: int = 0) -> tuple[str, dict]:
    return ("message_start", {
        "type": "message_start",
        "message": {
            "id": "msg_x", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
            "content": [], "stop_reason": None, "stop_sequence": None,
            "usage": {
                "input_tokens": input_tokens, "output_tokens": 1,
                "cache_creation_input_tokens": cache_write, "cache_read_input_tokens": cache_read,
            },
        },
    })


def text_block(index: int, text: str, citation: dict | None = None) -> list[tuple[str, dict]]:
    block: dict = {"type": "text", "text": ""}
    events = [("content_block_start", {"type": "content_block_start", "index": index, "content_block": block})]
    if citation is not None:
        events.append(("content_block_delta", {
            "type": "content_block_delta", "index": index,
            "delta": {"type": "citations_delta", "citation": citation},
        }))
    events += [
        ("content_block_delta", {"type": "content_block_delta", "index": index, "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": index}),
    ]
    return events


def search_call(index: int, tool_id: str, query: str) -> list[tuple[str, dict]]:
    return [
        ("content_block_start", {
            "type": "content_block_start", "index": index,
            "content_block": {"type": "server_tool_use", "id": tool_id, "name": "web_search", "input": {}},
        }),
        ("content_block_delta", {
            "type": "content_block_delta", "index": index,
            "delta": {"type": "input_json_delta", "partial_json": json.dumps({"query": query})},
        }),
        ("content_block_stop", {"type": "content_block_stop", "index": index}),
    ]


def search_result(index: int, tool_id: str, results: list[tuple[str, str]] | None, error: str = "") -> list[tuple[str, dict]]:
    content: object = (
        {"type": "web_search_tool_result_error", "error_code": error}
        if error
        else [
            {"type": "web_search_result", "url": url, "title": title, "encrypted_content": "ENC", "page_age": None}
            for title, url in results or []
        ]
    )
    return [
        ("content_block_start", {
            "type": "content_block_start", "index": index,
            "content_block": {"type": "web_search_tool_result", "tool_use_id": tool_id, "content": content},
        }),
        ("content_block_stop", {"type": "content_block_stop", "index": index}),
    ]


def end(stop_reason: str, output_tokens: int, searches: int = 0) -> list[tuple[str, dict]]:
    usage: dict = {"output_tokens": output_tokens}
    if searches:
        usage["server_tool_use"] = {"web_search_requests": searches}
    return [
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop_reason, "stop_sequence": None}, "usage": usage}),
        ("message_stop", {"type": "message_stop"}),
    ]


CITE = {
    "type": "web_search_result_location", "url": "https://kosis.kr/stat", "title": "KOSIS 인구",
    "encrypted_index": "EI", "cited_text": "서울 인구는…",
}


class Turns:
    """Answers each request with the next canned SSE body."""

    def __init__(self, bodies: list[bytes]) -> None:
        self.bodies = bodies
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        body = self.bodies[min(len(self.requests), len(self.bodies)) - 1]
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)


@pytest.fixture
def real(monkeypatch, config, db_session: Session):  # noqa: F811
    settings = use_settings(
        claude_provider="anthropic", anthropic_api_key=SECRET, anthropic_model="claude-sonnet-5-5"
    )
    open_tools(db_session)
    holder: dict = {}

    def make(_settings):
        return AnthropicClaudeProvider(
            settings,
            async_http_client=httpx.AsyncClient(transport=httpx.MockTransport(holder["turns"].handler)),
        )

    monkeypatch.setattr(chat_route, "get_claude_provider", make)

    def answer(*bodies: bytes) -> Turns:
        holder["turns"] = Turns(list(bodies))
        return holder["turns"]

    return answer


def searched_conversation(client: TestClient) -> int:
    conversation = new_conversation(client)
    turn_on(client, conversation, use_web_search=True)
    return conversation


# ------------------------------------------------------------ one search


def test_a_search_reply_reads_cleanly_and_keeps_its_sources_tidy(
    client: TestClient, db_session: Session, budgeted, real
) -> None:
    results = [
        ("KOSIS 인구", "https://kosis.kr/stat"),
        ("서울 열린데이터", "https://data.seoul.go.kr/a"),
        ("KOSIS 인구 (같은 주소)", "https://kosis.kr/stat/"),
    ]
    turns = real(sse(
        [start()]
        + text_block(0, "최신 자료를 찾아볼게요.")
        + search_call(1, "srvtoolu_1", "서울 인구 2026")
        + search_result(2, "srvtoolu_1", results)
        + text_block(3, "서울 인구는 ")
        + text_block(4, "약 930만 명이에요.", CITE)
        + end("end_turn", 120, searches=1)
    ))
    conversation = searched_conversation(client)
    events = events_of(send(client, conversation, "서울 인구 알려줘").text)

    # Text after the tool starts a paragraph; a citation split does not.
    assert reply_text(events) == "최신 자료를 찾아볼게요.\n\n서울 인구는 약 930만 명이에요."
    request = turns.requests[0]
    assert request["tools"][0]["type"] == "web_search_20250305"
    assert request["tools"][0]["max_uses"] == 5
    assert "allowed_callers" not in request["tools"][0]
    assert "Never describe tool internals" in request["system"][0]["text"]

    statuses = [(d["kind"], d["status"]) for n, d in events if n == "tool"]
    assert statuses == [("web_search", "running"), ("web_search", "done")]

    reply = db_session.query(ChatMessage).filter_by(role=ChatRole.ASSISTANT).one()
    assert reply.content.startswith("최신 자료를 찾아볼게요.\n\n")
    # Deduplicated by URL (the trailing slash is the same page), cited first.
    assert reply.sources == [
        {"title": "KOSIS 인구", "url": "https://kosis.kr/stat", "cited": True},
        {"title": "서울 열린데이터", "url": "https://data.seoul.go.kr/a", "cited": False},
    ]
    event = db_session.query(UsageEvent).one()
    assert event.web_search_count == 1


def test_a_failed_search_shows_an_error_status_and_bills_no_search(
    client: TestClient, db_session: Session, budgeted, real
) -> None:
    real(sse(
        [start()]
        + search_call(0, "srvtoolu_1", "q")
        + search_result(1, "srvtoolu_1", None, error="max_uses_exceeded")
        + text_block(2, "검색하지 못해 아는 범위에서 답할게요.")
        + end("end_turn", 30)
    ))
    events = events_of(send(client, searched_conversation(client), "날씨").text)

    assert ("web_search", "error") in [(d["kind"], d["status"]) for n, d in events if n == "tool"]
    assert not db_session.query(UsageEvent).one().web_search_count


# ------------------------------------------------------------ pause_turn


def test_a_paused_turn_is_continued_with_the_same_content_and_all_usage_is_charged(
    client: TestClient, db_session: Session, budgeted, real
) -> None:
    first = sse(
        [start(input_tokens=400)]
        + search_call(0, "srvtoolu_1", "q1")
        + search_result(1, "srvtoolu_1", [("A", "https://a.example/1")])
        + end("pause_turn", 50, searches=1)
    )
    second = sse(
        [start(input_tokens=900)]
        + text_block(0, "정리하면 이래요.", {**CITE, "url": "https://a.example/1", "title": "A"})
        + end("end_turn", 70)
    )
    turns = real(first, second)
    events = events_of(send(client, searched_conversation(client), "찾아줘").text)

    assert reply_text(events) == "정리하면 이래요."
    assert len(turns.requests) == 2
    resumed = turns.requests[1]
    # The paused assistant content goes back unchanged, with the same tools.
    assistant = resumed["messages"][-1]
    assert assistant["role"] == "assistant"
    assert [block["type"] for block in assistant["content"]] == ["server_tool_use", "web_search_tool_result"]
    assert assistant["content"][1]["content"][0]["encrypted_content"] == "ENC"
    assert resumed["tools"] == turns.requests[0]["tools"]
    assert resumed["max_tokens"] == turns.requests[0]["max_tokens"] - 50

    event = db_session.query(UsageEvent).one()
    assert (event.input_tokens, event.output_tokens, event.web_search_count) == (1_300, 120, 1)
    assert [d for n, d in events if n == "done"]


def test_a_turn_still_paused_after_every_continuation_ends_as_cut_off(
    client: TestClient, db_session: Session, budgeted, real
) -> None:
    paused = sse([start()] + text_block(0, "아직 찾는 중") + end("pause_turn", 10))
    turns = real(paused)
    events = events_of(send(client, searched_conversation(client), "찾아줘").text)

    assert len(turns.requests) == 4  # the first + 3 continuations
    assert [n for n, _ in events][-1] == "done"
    reply = db_session.query(ChatMessage).filter_by(role=ChatRole.ASSISTANT).one()
    assert reply.status.value == "truncated"


# ------------------------------------------------------------ code execution


def test_code_execution_blocks_show_as_code_execution(
    client: TestClient, db_session: Session, budgeted, real
) -> None:
    real(sse(
        [start()]
        + [
            ("content_block_start", {
                "type": "content_block_start", "index": 0,
                "content_block": {"type": "server_tool_use", "id": "srvtoolu_c", "name": "bash_code_execution", "input": {}},
            }),
            ("content_block_stop", {"type": "content_block_stop", "index": 0}),
            ("content_block_start", {
                "type": "content_block_start", "index": 1,
                "content_block": {
                    "type": "bash_code_execution_tool_result", "tool_use_id": "srvtoolu_c",
                    "content": {"type": "bash_code_execution_result", "stdout": "42\n", "stderr": "", "return_code": 0, "content": []},
                },
            }),
            ("content_block_stop", {"type": "content_block_stop", "index": 1}),
        ]
        + text_block(2, "계산 결과는 42예요.")
        + end("end_turn", 20)
    ))
    conversation = new_conversation(client)
    turn_on(client, conversation, use_code_execution=True)
    events = events_of(send(client, conversation, "6×7 계산해 줘").text)

    assert [(d["kind"], d["status"]) for n, d in events if n == "tool"] == [
        ("code_execution", "running"), ("code_execution", "done"),
    ]
    assert reply_text(events) == "계산 결과는 42예요."


# ------------------------------------------------------------ the stream itself


def test_a_quiet_stream_sends_keepalive_comments(
    client: TestClient, budgeted, config, monkeypatch  # noqa: F811
) -> None:
    """A server-side search can be silent for longer than the Next.js
    proxy's 30-second idle limit; a comment every few seconds keeps the
    connection open and the browser's reader skips it."""
    monkeypatch.setattr(chat_route, "KEEPALIVE_SECONDS", 0.01)
    monkeypatch.setattr(chat_route, "get_claude_provider", lambda _s: MockClaudeProvider(delay_ms=40))
    body = send(client, new_conversation(client), "안녕하세요").text

    assert ": keepalive\n\n" in body
    assert [n for n, _ in events_of(body)][-1] == "done"


def test_the_system_prompt_asks_for_an_answer_with_sources_and_no_internals() -> None:
    assert "always answer the question with what you found" in CHAT_SYSTEM_PROMPT
    assert "no JSON, parsing" in CHAT_SYSTEM_PROMPT


def test_the_source_list_dedupes_orders_and_caps() -> None:
    sources = SourceList()
    for i in range(30):
        sources._add(f"https://site{i}.example/p", f"페이지 {i}")
    sources.cite("https://site7.example/p#x", "")
    sources.cite("javascript:alert(1)", "bad")
    ordered = sources.ordered()
    assert len(ordered) == SourceList.LIMIT
    assert ordered[0] == ("페이지 7", "https://site7.example/p", True)
    assert all(url.startswith("https://") for _, url, _ in ordered)


# ------------------------------------------------------------ the Builder race


def test_a_second_starter_for_the_same_project_is_refused_not_a_500(
    client: TestClient, db_session: Session, dev_user, budgeted, config, monkeypatch  # noqa: F811
) -> None:
    """2026-10-14 12:08 UTC on the server: a retried 예시 앱 hit the unique
    path constraint after the first request had stored its files."""
    project = BuilderProject(owner_user_id=dev_user.id, name="가계부")
    db_session.add(project)
    db_session.commit()
    mock = MockClaudeProvider()
    original = mock.generate_starter_app

    def slow_starter(*args, **kwargs):
        app = original(*args, **kwargs)
        # Meanwhile, the first request finished and stored its files.
        db_session.add(BuilderProjectFile(project_id=project.id, path="index.html", content="<p>1</p>"))
        db_session.commit()
        return app

    mock.generate_starter_app = slow_starter
    monkeypatch.setattr(builder_route, "get_claude_provider", lambda _s: mock)
    response = client.post(f"/api/builder/projects/{project.id}/starter", json={"idea": ""})

    assert response.status_code == 409
    assert "이미 예시 앱" in response.json()["detail"]
    event = db_session.query(UsageEvent).one()
    assert event.charged_krw == 0 and event.club_absorbed is True
