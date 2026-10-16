"""chat-pins — 맨 위에 고정 for conversations.

The same 고정 Builder and Video projects got in ui-improvements: the
owner's own flag with a timestamp, so the Chat list can put pinned
conversations first (newest pin first) and keep the rest by date. A pin
is a reading preference, not an edit — it moves neither `updated_at`
nor `last_message_at`, and it is open to the owner while not
participating.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import QuarterMembership
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD
from tests.test_chat import config, new_conversation  # noqa: F401 — the fixture


def test_a_conversation_is_pinned_with_a_timestamp_and_unpinned_again(
    client: TestClient, budgeted, config
) -> None:
    conversation_id = new_conversation(client)
    before = client.get(f"/api/chat/conversations/{conversation_id}").json()
    assert before["pinned_at"] is None
    assert client.get("/api/chat/conversations").json()[0]["pinned_at"] is None

    pinned = client.post(f"/api/chat/conversations/{conversation_id}/pin", json={"on": True})
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned_at"] is not None
    # A pin is not an edit, and it does not move the conversation's date.
    assert pinned.json()["last_message_at"] == before["last_message_at"]
    # The list carries the pin; a rename leaves it; the detail agrees.
    assert client.get("/api/chat/conversations").json()[0]["pinned_at"] == pinned.json()["pinned_at"]
    renamed = client.patch(f"/api/chat/conversations/{conversation_id}", json={"title": "가계부"}).json()
    assert renamed["pinned_at"] == pinned.json()["pinned_at"]
    assert client.get(f"/api/chat/conversations/{conversation_id}").json()["pinned_at"] == pinned.json()["pinned_at"]
    # `pinned_at` is not a PATCH field: a real value is not applied (the
    # payload has nothing the route knows → 400) and the pin is unchanged.
    assert (
        client.patch(f"/api/chat/conversations/{conversation_id}", json={"pinned_at": "2030-01-01T00:00:00Z"}).status_code
        == 400
    )
    assert client.get(f"/api/chat/conversations/{conversation_id}").json()["pinned_at"] == pinned.json()["pinned_at"]

    unpinned = client.post(f"/api/chat/conversations/{conversation_id}/pin", json={"on": False})
    assert unpinned.status_code == 200, unpinned.text
    assert unpinned.json()["pinned_at"] is None
    # The JSON-body rule holds for the pin too (CLAUDE.md §2).
    assert client.post(
        f"/api/chat/conversations/{conversation_id}/pin", content="true", headers={"Content-Type": "text/plain"}
    ).status_code in (415, 422)


def test_only_the_owner_pins_and_a_member_not_participating_still_may(
    client: TestClient, db_session: Session, budgeted, dev_user, other_user, config
) -> None:
    conversation_id = new_conversation(client)

    # Another member: 404, as for every other conversation route.
    login = client.post("/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD})
    assert login.status_code == 200, login.text
    assert client.post(f"/api/chat/conversations/{conversation_id}/pin", json={"on": True}).status_code == 404

    # The owner, no longer participating: reading preferences still work.
    login = client.post("/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD})
    assert login.status_code == 200, login.text
    for row in db_session.query(QuarterMembership).all():
        db_session.delete(row)
    db_session.commit()
    assert client.patch(f"/api/chat/conversations/{conversation_id}", json={"title": "x"}).status_code == 403
    pinned = client.post(f"/api/chat/conversations/{conversation_id}/pin", json={"on": True})
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned_at"] is not None
