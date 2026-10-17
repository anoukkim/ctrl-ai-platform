"""chat-plus-artifacts — the backend half.

The preview runs in the member's browser, in a sandboxed frame with no
origin; nothing here executes a reply. What the backend does: tell Claude
to write self-contained html/svg blocks, and Builder로 보내기 — a project
whose index.html is the block, free, for participating members only.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import BuilderProject, BuilderProjectFile, UsageEvent
from app.services.claude_provider import CHAT_SYSTEM_PROMPT, example_reply

PAGE = "<!doctype html><html><body><h1>안녕</h1></body></html>"


def test_builder_로_보내기_creates_one_project_with_one_index_html(
    client: TestClient, db_session: Session, participating
) -> None:
    response = client.post(
        "/api/builder/projects/from-chat",
        json={"name": "동아리 소개", "description": "동아리 소개 페이지를 만들어 줘", "html": PAGE},
    )
    assert response.status_code == 201, response.text
    project = db_session.query(BuilderProject).one()
    # No conversation: the name sent stands (from a conversation, the page names it).
    assert project.name == "동아리 소개"
    assert project.description == "동아리 소개 페이지를 만들어 줘"
    files = db_session.query(BuilderProjectFile).all()
    assert [(f.path, f.content) for f in files] == [("index.html", PAGE)]
    # Free: nothing generated, nothing charged.
    assert db_session.query(UsageEvent).count() == 0


def test_an_unusable_name_falls_back(client: TestClient, db_session: Session, participating) -> None:
    nameless = "<!doctype html><html><body><p>내용</p></body></html>"
    response = client.post(
        "/api/builder/projects/from-chat", json={"name": "   ", "description": "", "html": nameless}
    )
    assert response.status_code == 201
    assert db_session.query(BuilderProject).one().name == "채팅에서 만든 페이지"


def test_a_page_over_200kb_is_refused(client: TestClient, db_session: Session, participating) -> None:
    response = client.post(
        "/api/builder/projects/from-chat",
        json={"name": "큰 페이지", "description": "", "html": "가" * 70_000},
    )
    assert response.status_code == 400 and "200KB" in response.json()["detail"]
    assert db_session.query(BuilderProject).count() == 0


def test_a_member_not_participating_is_refused(other_client: TestClient, db_session: Session) -> None:
    response = other_client.post(
        "/api/builder/projects/from-chat", json={"name": "x", "description": "", "html": PAGE}
    )
    assert response.status_code == 403
    assert db_session.query(BuilderProject).count() == 0


def test_claude_is_told_to_write_self_contained_previewable_blocks() -> None:
    assert "self-contained ```html block" in CHAT_SYSTEM_PROMPT
    assert "No external scripts, fonts, images or network requests" in CHAT_SYSTEM_PROMPT


def test_the_mocks_page_and_chart_replies_carry_html_and_svg_blocks() -> None:
    page = example_reply("동아리 소개 한 장짜리 웹페이지를 만들어 줘")
    chart = example_reply("회원 수가 12명, 18명, 25명, 31명이야. 차트로 보여 줘")
    assert page is not None and "```html\n<!doctype html>" in page
    assert chart is not None and "```svg\n<svg" in chart
