"""feat-spend-feedback (owner add-on B, 2026-10-14) — the backend half.

The animation and the toast live in the browser; what is pinned here is
what they are fed: milestones recorded once per member and quarter, the
highest one returned when a charge crosses several, figures read from the
wallet (never the browser), the member's switch, and `charged_krw` on the
video responses that charged.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import SpendMilestone
from app.services import milestones
from app.services import usage as usage_service


def claim(client: TestClient):
    response = client.post("/api/usage/me/milestones", json={})
    assert response.status_code == 200, response.text
    return response.json()


def spend(db: Session, user, amount: int) -> None:
    usage_service.charge(db, user=user, amount_krw=amount, provider="claude", feature="chat")


def test_thresholds() -> None:
    assert milestones.crossed(100_000, 0) == set()
    assert milestones.crossed(100_000, 1) == {"first"}
    assert milestones.crossed(100_000, 25_000) == {"first", "used_25"}
    assert milestones.crossed(100_000, 74_999) == {"first", "used_25", "used_50"}
    assert milestones.crossed(100_000, 90_000) == {"first", "used_25", "used_50", "used_75", "low"}
    assert "empty" in milestones.crossed(100_000, 100_000)


def test_each_milestone_shows_once_per_quarter(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    assert claim(client)["milestone"] is None  # nothing spent yet

    spend(db_session, dev_user, 12)
    first = claim(client)
    assert first["milestone"] == "first"
    assert first["remaining_krw"] == 100_000 - 12 and first["percent_used"] == 0
    assert claim(client)["milestone"] is None  # not again

    spend(db_session, dev_user, 30_000)
    assert claim(client)["milestone"] == "used_25"
    assert claim(client)["milestone"] is None


def test_a_charge_that_jumps_two_thresholds_shows_only_the_higher(
    client: TestClient, db_session: Session, budgeted, dev_user
) -> None:
    spend(db_session, dev_user, 10)
    claim(client)
    spend(db_session, dev_user, 60_000)  # 0% → 60%: crosses 25 and 50
    assert claim(client)["milestone"] == "used_50"
    kinds = {row.kind for row in db_session.query(SpendMilestone).all()}
    assert kinds == {"first", "used_25", "used_50"}  # 25 is recorded, never shown later
    spend(db_session, dev_user, 32_000)  # 92%: 75 and low together → low wins
    assert claim(client)["milestone"] == "low"
    spend(db_session, dev_user, 7_990)
    assert claim(client)["milestone"] == "empty"


def test_milestones_are_per_quarter(client: TestClient, db_session: Session, budgeted, dev_user) -> None:
    spend(db_session, dev_user, 10)
    claim(client)
    row = db_session.query(SpendMilestone).one()
    assert row.quarter_id == budgeted.quarter_id and row.user_id == dev_user.id


def test_no_wallet_means_nothing_to_claim(client: TestClient, participating) -> None:
    assert client.post("/api/usage/me/milestones", json={}).json() is None


def test_the_claim_route_requires_a_json_body(client: TestClient, budgeted) -> None:
    """Every state-changing route needs a JSON body (CLAUDE.md §2)."""
    assert client.post("/api/usage/me/milestones").status_code == 422


def test_the_member_switch(client: TestClient) -> None:
    assert client.get("/api/account/preferences").json() == {"spend_notifications": True}
    assert client.get("/api/auth/me").json()["spend_notifications"] is True
    changed = client.patch("/api/account/preferences", json={"spend_notifications": False})
    assert changed.status_code == 200 and changed.json() == {"spend_notifications": False}
    assert client.get("/api/auth/me").json()["spend_notifications"] is False


def test_a_member_not_participating_may_still_change_it(other_client: TestClient) -> None:
    assert other_client.patch(
        "/api/account/preferences", json={"spend_notifications": False}
    ).status_code == 200


def test_a_video_charge_response_carries_the_ledgers_figure(
    client: TestClient, db_session: Session, dev_user, video_models, budgeted
) -> None:
    from app.models import UsageEvent, VideoProject

    project = VideoProject(owner_user_id=dev_user.id, name="노을", prompt="바다 위 노을")
    db_session.add(project)
    db_session.commit()
    version = client.post(f"/api/video/projects/{project.id}/versions").json()
    event = db_session.query(UsageEvent).one()
    assert version["charged_krw"] == event.charged_krw > 0
    # Listing the project's versions later shows no charge figure.
    listed = client.get(f"/api/video/projects/{project.id}").json()["versions"][0]
    assert listed["charged_krw"] is None
