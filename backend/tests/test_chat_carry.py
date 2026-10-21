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
    assert sum(1 for line in spec.splitlines() if line[:1].isdigit()) == 3
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


def test_a_hostile_page_is_named_quickly() -> None:
    """The page is the member's, up to 200 KB: the name search reads only
    its head with plain string searches — no backtracking."""
    import time

    for page in ("<title>" * 28_000, "<h1>" * 50_000, "<" * 199_000, "<title>" + "a" * 199_000):
        started = time.monotonic()
        chat_carry.page_name(page)
        chat_carry._plain(page)
        assert time.monotonic() - started < 0.5, page[:20]


def test_from_a_conversation_the_cut_title_is_never_the_name(
    client: TestClient, db_session: Session, participating, dev_user, monkeypatch
) -> None:
    conversation, _ = conversation_with(db_session, dev_user, ["가계부"])

    async def no_name(*args, **kwargs):
        return None

    monkeypatch.setattr(chat_carry, "claude_name", no_name)
    response = client.post(
        "/api/builder/projects/from-chat",
        json={"name": "영화 제목을 검색하면 후보를 보", "html": "<p>x</p>", "conversation_id": conversation.id},
    )
    assert response.status_code == 201
    assert db_session.query(BuilderProject).one().name == "채팅에서 만든 페이지"


# ------------------------------------------------ 파일로 나누기 and Claude's explanation

INLINE_PAGE = (
    "<!doctype html><html><head><title>숫자 맞추기</title><style>body{color:red}</style>"
    "<style>h1{margin:0}</style></head><body><h1>게임</h1>"
    "<script>var a = 1;</script><p>중간</p>"
    '<script type="application/json" id="d">{"x":1}</script>'
    '<script src="other.js"></script><script>var b = 2;</script></body></html>'
)


def test_split_moves_inline_css_and_js_into_files() -> None:
    files = chat_carry.split_page(INLINE_PAGE)
    assert files is not None and set(files) == {"index.html", "style.css", "app.js"}
    assert files["style.css"] == "body{color:red}\n\nh1{margin:0}\n"
    assert files["app.js"] == "var a = 1;\n\nvar b = 2;\n"
    html = files["index.html"]
    assert html.count('<link rel="stylesheet" href="style.css">') == 1
    assert "<style" not in html
    # linked where the last inline script stood; data and src scripts stay
    assert html.count('<script src="app.js"></script>') == 1 and html.index('src="app.js"') > html.index('src="other.js"')
    assert 'type="application/json"' in html and "var a" not in html


def test_split_gives_nothing_for_a_page_without_inline_code() -> None:
    assert chat_carry.split_page("<html><body><h1>글</h1></body></html>") is None
    assert chat_carry.split_page("<style>a{}</style" + "x" * 50_000) is None  # unclosed: quick, untouched


def test_the_split_files_pass_the_builders_own_rules() -> None:
    for path, content in (chat_carry.split_page(INLINE_PAGE) or {}).items():
        assert builder_files.clean_path(path) == path and content


def test_from_chat_can_split_and_spec_keeps_claudes_explanation(
    client: TestClient, db_session: Session, participating, dev_user
) -> None:
    conversation, rows = conversation_with(db_session, dev_user, ["숫자 맞추기를 만들어 줘"])
    reply = rows[1]
    reply.content = "점수는 시도 횟수로 정해져요.\n\n```html\n<p>코드는 빠져요</p>\n```\n\n기록은 5개까지 저장돼요."
    db_session.commit()
    response = client.post(
        "/api/builder/projects/from-chat",
        json={"html": INLINE_PAGE, "conversation_id": conversation.id, "reply_id": reply.id, "split": True},
    )
    assert response.status_code == 201, response.text
    project = db_session.query(BuilderProject).one()
    paths = {f.path: f.content for f in db_session.query(BuilderProjectFile).filter_by(project_id=project.id)}
    assert {"index.html", "style.css", "app.js", "SPEC.md"} == set(paths)
    spec = paths["SPEC.md"]
    assert "## Claude가 설명한 내용" in spec and "점수는 시도 횟수로 정해져요." in spec and "기록은 5개까지" in spec
    assert "코드는 빠져요" not in spec


def test_without_split_it_is_one_file_as_before(
    client: TestClient, db_session: Session, participating, dev_user
) -> None:
    response = client.post("/api/builder/projects/from-chat", json={"html": INLINE_PAGE})
    assert response.status_code == 201, response.text
    paths = {f.path for f in db_session.query(BuilderProjectFile)}
    assert paths == {"index.html"}


def test_someone_elses_reply_explains_nothing(db_session: Session, dev_user, participating) -> None:
    conversation, rows = conversation_with(db_session, dev_user, ["질문"])
    other = Conversation(user_id=dev_user.id + 999, title="x")
    db_session.add(other)
    db_session.commit()
    assert chat_carry.explanation(db_session, dev_user, other.id, rows[1].id) == ""
    assert chat_carry.explanation(db_session, dev_user, conversation.id, rows[0].id) == ""  # a user message
