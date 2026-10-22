"""auto-depth — 자동 as the default 생각 깊이 (owner, 2026-10-22).

What is proved: the rules pick 낮음 / 보통 / 높음 (never 최고) from the
request; nothing chosen means 자동; 자동 is accepted where a depth is
saved; the usage event records the depth actually used; the picker gets a
자동 option whose maximum is 높음's cap; the Builder picks 높음 for the
first build and keeps a run's depth fixed by its plan.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import ChatModel, UsageEvent
from app.services import depth as depth_service
from app.services.depth import AUTO, AutoHint, auto_level
from tests.test_chat import config, send  # noqa: F401

pytestmark = pytest.mark.real_auto_depth


@pytest.mark.parametrize(
    ("text", "files", "expected"),
    [
        ("안녕", 0, "low"),
        ("고마워요!", 0, "low"),
        ("주말에 서울에서 가볼 만한 전시회나 산책 코스를 추천해 줄 수 있을까요?", 0, "medium"),
        ("이 파이썬 코드에서 버그를 찾아 줘", 0, "high"),
        ("두 요금제를 비교해서 정리해 줘", 0, "high"),
        ("```js\nconsole.log(1)\n```", 0, "high"),
        ("이거 봐 줘", 1, "high"),
        ("가" * 700, 0, "high"),
    ],
)
def test_chat_rules(text: str, files: int, expected: str) -> None:
    assert auto_level("chat", AutoHint(text=text, files=files)) == expected


def test_builder_rules() -> None:
    assert auto_level("builder", AutoHint(text="버튼 색 바꿔 줘", creating=True)) == "high"
    assert auto_level("builder", AutoHint(text="버튼 색 바꿔 줘")) == "medium"
    assert auto_level("builder", AutoHint(text="기능 " * 200)) == "high"


def test_auto_never_picks_max_and_nothing_chosen_means_auto() -> None:
    hard = AutoHint(text="코드 " * 400, files=3)
    level, effort = depth_service.resolve(None, "chat", "claude-sonnet-5-5", None, hint=hard)
    assert (level.name, effort) == ("high", "high")
    level, effort = depth_service.resolve(None, "chat", "claude-sonnet-5-5", AUTO, hint=AutoHint(text="안녕"))
    assert (level.name, effort) == ("low", "low")
    # A member's own choice still wins.
    level, _ = depth_service.resolve(None, "chat", "claude-sonnet-5-5", "max", hint=AutoHint(text="안녕"))
    assert level.name == "max"
    # A model without depths: 보통's room, no effort — 자동 changes nothing.
    level, effort = depth_service.resolve(None, "chat", "claude-haiku-4-5", AUTO, hint=hard)
    assert (level.name, effort) == ("medium", None)


def test_the_picker_offers_auto_with_highs_cap(client: TestClient, budgeted, config) -> None:  # noqa: F811
    info = client.get("/api/chat/info").json()
    assert info["member_default_depth"] == "auto"
    sonnet = next(row for row in info["models"] if row["model_id"] == "claude-sonnet-5-5")
    high = next(step for step in sonnet["levels"] if step["level"] == "high")
    assert sonnet["auto"]["level"] == "auto"
    assert sonnet["auto"]["max_krw"] == high["max_krw"]
    assert all(step["level"] != "auto" for step in sonnet["levels"])
    haiku = next(row for row in info["models"] if row["model_id"] == "claude-haiku-4-5")
    assert haiku["auto"] is None


def test_a_conversation_on_auto_records_the_depth_it_used(
    client: TestClient, db_session: Session, budgeted, config  # noqa: F811
) -> None:
    sonnet = db_session.query(ChatModel).filter_by(model_id="claude-sonnet-5-5").one()
    created = client.post("/api/chat/conversations", json={"chat_model_id": sonnet.id, "depth": "auto"})
    assert created.status_code == 201, created.text
    conversation = created.json()["id"]
    assert send(client, conversation, "안녕").status_code == 200
    assert send(client, conversation, "이 함수의 버그 원인을 분석해 줘").status_code == 200
    depths = [event.depth for event in db_session.query(UsageEvent).order_by(UsageEvent.id)]
    assert depths == ["low", "high"]
    # The conversation stays on 자동.
    assert client.get(f"/api/chat/conversations/{conversation}").json()["depth"] == "auto"


def test_auto_is_accepted_as_a_members_default(client: TestClient, budgeted) -> None:
    saved = client.patch("/api/account/preferences", json={"default_depth": "auto"})
    assert saved.status_code in (200, 204), saved.text


def test_the_builder_estimate_shows_autos_worst_case_before_the_request_is_known(
    client: TestClient, db_session: Session, budgeted, config  # noqa: F811
) -> None:
    """With an app already built, a short change runs at 보통 — but the
    estimate shown before the request is typed is 높음's, the most 자동 can
    reserve."""
    from app.core.config import get_settings
    from app.models import BuilderProject
    from app.services import builder_choice, builder_edit

    project = BuilderProject(owner_user_id=budgeted.user_id, name="앱", description="")
    db_session.add(project)
    db_session.commit()
    from app.models import User

    user = db_session.get(User, budgeted.user_id)
    settings = get_settings()
    shown = builder_edit.estimate(db_session, settings, user, project, "")
    assert shown.depth == "high"
    assert shown.depth_setting == "auto"
    short = builder_choice.choose(db_session, settings, user, project, request="버튼 색 바꿔 줘", creating=False)
    assert short.level.name == "medium"
