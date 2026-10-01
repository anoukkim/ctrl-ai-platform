"""Participation decides who may create, edit and delete — everywhere.

`tests/test_membership.py` proves the three statuses behave correctly.
This module is narrower and more boring on purpose: it walks **every**
guarded endpoint and checks the same rule holds on each one, so a route
added later without a guard fails a test instead of shipping.

The bug this came from was not that the rule was wrong. It was that the
rule was applied to two endpoints out of five, and nothing noticed.

The rule:

* **active** — may create, edit and delete.
* **inactive, or no membership row at all** — 403 on all of it, and may
  still read everything they own.
* **former** — cannot sign in, so never reaches any of this.
* **admin** — the role opens `/api/admin/*`; it does not open creation.
  An admin who did not join this quarter is refused like anyone else.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import MembershipStatus, Quarter, QuarterStatus
from app.services.quarters import current_quarter, set_membership


@pytest.fixture
def quarter(db_session: Session) -> Quarter:
    existing = current_quarter(db_session)
    if existing is not None:
        return existing

    row = Quarter(
        code="2026-Q4",
        display_name="2026 Q4",
        starts_at=date(2026, 10, 1),
        ends_at=date(2026, 12, 31),
        status=QuarterStatus.ACTIVE,
        subsidy_limit_krw=100_000,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def participate(db_session: Session, user_id: int, quarter_id: int, status) -> None:
    set_membership(db_session, user_id, quarter_id, status)
    db_session.commit()


@pytest.fixture
def work(client: TestClient, dev_user, quarter, db_session, video_models) -> dict[str, int]:
    """One Builder project and one video project, made while active.

    The member is left **active**; each test sets the status it wants.
    Making the rows first matters: an edit or delete test needs something
    that really exists, or a 404 could be mistaken for a refusal.
    """
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)

    builder = client.post("/api/builder/projects", json={"name": "내 앱"})
    assert builder.status_code == 201, builder.text

    video = client.post("/api/video/projects", json={"name": "내 영상"})
    assert video.status_code == 201, video.text

    return {"builder_id": builder.json()["id"], "video_id": video.json()["id"]}


def guarded_calls(work: dict[str, int]) -> list[tuple[str, str, str, dict | None]]:
    """Every endpoint that creates, edits or deletes member work.

    Returned as (label, method, path, json) so a failure names the route
    rather than an index. Keep this list in step with the access table in
    `docs/architecture.md`; both describe the same rule.
    """
    builder_id = work["builder_id"]
    video_id = work["video_id"]
    return [
        ("Builder 만들기", "post", "/api/builder/projects", {"name": "새 앱"}),
        ("Builder 수정", "patch", f"/api/builder/projects/{builder_id}", {"name": "고친 이름"}),
        ("Builder 삭제", "delete", f"/api/builder/projects/{builder_id}", None),
        ("Video 만들기", "post", "/api/video/projects", {"name": "새 영상"}),
        ("Video 수정", "patch", f"/api/video/projects/{video_id}", {"prompt": "밤의 서울"}),
        ("Video 생성", "post", f"/api/video/projects/{video_id}/versions", None),
    ]


def call(client: TestClient, method: str, path: str, payload: dict | None):
    if payload is None:
        return getattr(client, method)(path)
    return getattr(client, method)(path, json=payload)


# --------------------------------------------------------------- refused


def test_an_inactive_member_is_refused_everywhere(
    client: TestClient, dev_user, quarter, db_session, work
) -> None:
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    for label, method, path, payload in guarded_calls(work):
        response = call(client, method, path, payload)
        assert response.status_code == 403, f"{label} ({method.upper()} {path}) → {response.status_code}"
        # Korean, and it explains what still works rather than only refusing.
        detail = response.json()["detail"]
        assert "참여" in detail, f"{label}: {detail}"


def test_a_member_with_no_membership_row_is_refused_everywhere(
    client: TestClient, dev_user, quarter, db_session, work
) -> None:
    """A missing row means "not participating". No inactive row is written."""
    from app.models import QuarterMembership

    row = db_session.query(QuarterMembership).filter_by(
        user_id=dev_user.id, quarter_id=quarter.id
    ).one()
    db_session.delete(row)
    db_session.commit()

    for label, method, path, payload in guarded_calls(work):
        response = call(client, method, path, payload)
        assert response.status_code == 403, f"{label} ({method.upper()} {path}) → {response.status_code}"


def test_a_refused_edit_changes_nothing(
    client: TestClient, dev_user, quarter, db_session, work
) -> None:
    """403 must mean the row is untouched, not just that the reply said no."""
    from app.models import BuilderProject

    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    client.patch(f"/api/builder/projects/{work['builder_id']}", json={"name": "몰래 고치기"})
    client.delete(f"/api/builder/projects/{work['builder_id']}")

    db_session.expire_all()
    project = db_session.get(BuilderProject, work["builder_id"])
    assert project is not None, "삭제가 막히지 않았습니다"
    assert project.name == "내 앱"


# --------------------------------------------------------------- allowed


def test_an_active_member_is_allowed_everywhere(
    client: TestClient, dev_user, quarter, db_session, work
) -> None:
    """The same sweep, with the membership the rule asks for."""
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.ACTIVE)

    for label, method, path, payload in guarded_calls(work):
        response = call(client, method, path, payload)
        assert response.status_code in (200, 201, 204), (
            f"{label} ({method.upper()} {path}) → {response.status_code}: {response.text}"
        )


def test_an_inactive_member_may_still_read_everything_they_own(
    client: TestClient, dev_user, quarter, db_session, work
) -> None:
    """Not participating must never make a member's own work disappear."""
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    readable = [
        "/api/auth/me",
        "/api/builder/projects",
        f"/api/builder/projects/{work['builder_id']}",
        "/api/video/projects",
        f"/api/video/projects/{work['video_id']}",
        "/api/video/models",
        "/api/usage/me",
        "/api/quarters/me",
        "/api/quarters/current",
        "/api/quarters/me/wallet",
    ]

    for path in readable:
        response = client.get(path)
        assert response.status_code == 200, f"GET {path} → {response.status_code}"

    # And the work is really there, not an empty list.
    assert [p["name"] for p in client.get("/api/builder/projects").json()] == ["내 앱"]


def test_an_inactive_member_may_still_apply_for_the_quarter(
    client: TestClient, dev_user, quarter, db_session
) -> None:
    """Applying is how a member stops being inactive.

    Guarding the application route with `require_active_member` would be
    a trap with no way out, so it deliberately stays on
    `get_current_user`. This test exists to stop someone "fixing" that.
    """
    from app.models import QuarterStatus

    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)
    quarter.status = QuarterStatus.APPLICATION_OPEN
    db_session.commit()

    response = client.post(
        f"/api/quarters/{quarter.id}/apply",
        json={"build_percentage": 70, "video_percentage": 30},
    )

    assert response.status_code in (200, 201), response.text


# ----------------------------------------------------------------- admin


def test_admin_pages_work_for_an_admin_who_is_not_participating(
    client: TestClient, dev_user, quarter, db_session
) -> None:
    """The Admin screens must not go dark because the admin sat out a quarter."""
    from app.models import UserRole

    assert dev_user.role is UserRole.ADMIN
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    for path in [
        "/api/users",
        "/api/admin/quarters",
        "/api/admin/video-models",
        "/api/admin/audit",
        "/api/admin/top-ups",
    ]:
        response = client.get(path)
        assert response.status_code == 200, f"GET {path} → {response.status_code}"


def test_an_admin_who_is_not_participating_still_cannot_create(
    client: TestClient, dev_user, quarter, db_session, work
) -> None:
    """Being an admin is not a way around the participation rule."""
    from app.models import UserRole

    assert dev_user.role is UserRole.ADMIN
    participate(db_session, dev_user.id, quarter.id, MembershipStatus.INACTIVE)

    for label, method, path, payload in guarded_calls(work):
        response = call(client, method, path, payload)
        assert response.status_code == 403, f"{label} ({method.upper()} {path}) → {response.status_code}"


def test_a_member_cannot_reach_admin_pages(other_client: TestClient) -> None:
    """The other half of the rule: participation is not a route to Admin."""
    for path in ["/api/users", "/api/admin/quarters", "/api/admin/audit"]:
        assert other_client.get(path).status_code == 403, path
