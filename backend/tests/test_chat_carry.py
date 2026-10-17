"""chat-to-builder-carry (owner, 2026-10-17) — the 미리보기 travels with its
name and the member's requests.

The page names the project (`<title>`, else the first heading, shortened);
only a page with neither is named by one tiny Claude call the club absorbs
(0원 to the member). The member's messages in that conversation, up to
the reply the page came from, become SPEC.md — a guide document (never
served), read by every Builder call — free, taken as they are.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import BuilderProject, BuilderProjectFile, ChatMessage, ChatRole, Conversation, UsageEvent
from app.services import app_runtime, builder_files, chat_carry
from app.services.claude_provider import PLAN_SYSTEM

PAGE = (
    "<!doctype html><html><head><title>영화 연결 지도 — 감독과 배우를 잇는 그래프 탐색기 베타 버전</title>"
    "</head><body><h1>다른 제목</h1></body></html>"
)


def conversation_with(db: Session, user, said: list[str]) -> tuple[Conversation, list[ChatMessage]]:
    conversation = Conversation(user_id=user.id, title="영화 제목을 검색하면")
    db.add(conversation)
    db.flush()
    rows = []
    for text in said:
        for role, content in ((ChatRole.USER, text), (ChatRole.ASSISTANT, "네, 만들었어요.")):
            row = ChatMessage(conversation_id=conversation.id, user_id=user.id, role=role, content=content)
            db.add(row)
            db.flush()
            rows.append(row)
    db.commit()
    return conversation, rows


def test_the_page_names_the_project_shortened() -> None:
    assert chat_carry.page_name(PAGE) == "영화 연결 지도 — 감독과 배우를 잇는 그래프 탐색기…"
    assert chat_carry.page_name("<body><h2>  가계부 &amp; 메모 </h2></body>") == "가계부 & 메모"
    assert chat_carry.page_name("<body><p>제목 없음</p></body>") is None
    assert len(chat_carry.page_name(PAGE) or "") <= chat_carry.NAME_CHARS + 1


def test_the_requests_up_to_the_reply_become_spec_md(
    client: TestClient, db_session: Session, participating, dev_user
) -> None:
    conversation, rows = conversation_with(
        db_session, dev_user, ["영화 연결 지도를 만들어 줘", "포스터도 보여 줘", "어두운 색으로 해 줘", "나중 질문"]
    )
    reply = rows[5]  # the reply to the third request
    response = client.post(
        "/api/builder/projects/from-chat",
        json={"name": "영화 제목을 검색하면", "html": PAGE, "conversation_id": conversation.id, "reply_id": reply.id},
    )
    assert response.status_code == 201, response.text
    project = db_session.query(BuilderProject).one()
    assert project.name.startswith("영화 연결 지도")
    files = {f.path: f.content for f in db_session.query(BuilderProjectFile).all()}
    assert set(files) == {"index.html", "SPEC.md"}
    spec = files["SPEC.md"]
    assert "1. 영화 연결 지도를 만들어 줘" in spec and "3. 어두운 색으로 해 줘" in spec
    assert "나중 질문" not in spec
    assert chat_carry.count_in(spec) == 3
    # A guide: never served on the app's address.
    assert builder_files.is_guide("SPEC.md")
    assert "SPEC.md" not in builder_files.app_files(files)
    # Taken as they are: free, no call.
    assert db_session.query(UsageEvent).count() == 0
    # Every Builder plan is told what SPEC.md is.
    assert "SPEC.md" in PLAN_SYSTEM


def test_someone_elses_conversation_gives_nothing(
    client: TestClient, db_session: Session, participating, other_user
) -> None:
    conversation, _ = conversation_with(db_session, other_user, ["비밀 계획"])
    response = client.post(
        "/api/builder/projects/from-chat", json={"html": PAGE, "conversation_id": conversation.id}
    )
    assert response.status_code == 201
    paths = [f.path for f in db_session.query(BuilderProjectFile).all()]
    assert paths == ["index.html"]


def test_a_page_without_a_name_is_named_by_one_absorbed_call(
    client: TestClient, db_session: Session, participating, dev_user
) -> None:
    conversation, _ = conversation_with(db_session, dev_user, ["독서 기록장 만들어 줘"])
    nameless = "<!doctype html><html><body><p>책 목록</p></body></html>"
    response = client.post(
        "/api/builder/projects/from-chat",
        json={"name": "독서 기록장 만들어 줘 그리고 또", "html": nameless, "conversation_id": conversation.id},
    )
    assert response.status_code == 201, response.text
    assert db_session.query(BuilderProject).one().name == "독서 기록장 만들어 줘"
    event = db_session.query(UsageEvent).one()
    assert event.feature == "project_name"
    assert event.charged_krw == 0 and event.club_absorbed
