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

from app.models import MembershipStatus, Quarter, QuarterAllocation, QuarterStatus
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
    # A budget too, so that "allowed" means allowed: generating, editing
    # and extending all spend, and without money they would be refused
    # with 402 rather than let through.
    db_session.add(
        QuarterAllocation(
            user_id=dev_user.id,
            quarter_id=quarter.id,
            community_total_budget_krw=100_000,
            build_budget_krw=30_000,
            video_budget_krw=70_000,
            build_percentage=30,
            video_percentage=70,
        )
    )
    db_session.commit()

    builder = client.post("/api/builder/projects", json={"name": "내 앱"})
    assert builder.status_code == 201, builder.text

    video = client.post("/api/video/projects", json={"name": "내 영상"})
    assert video.status_code == 201, video.text
    video_id = video.json()["id"]

    # Something to edit and extend. Auto picks Kling, which supports both.
    version = client.post(f"/api/video/projects/{video_id}/versions")
    assert version.status_code == 201, version.text

    return {
        "builder_id": builder.json()["id"],
        "video_id": video_id,
        "version_id": version.json()["id"],
    }


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
        (
            "Video 수정하기",
            "post",
            f"/api/video/projects/{video_id}/versions/{work['version_id']}/edit",
            {"instruction": "더 어둡게"},
        ),
        (
            "Video 이어서 만들기",
            "post",
            f"/api/video/projects/{video_id}/versions/{work['version_id']}/extend",
            {"duration_seconds": 5},
        ),
        (
            "Video 프롬프트 도움받기",
            "post",
            f"/api/video/projects/{video_id}/prompt-help",
            {"prompt": "밤의 서울", "request": "더 밝게"},
        ),
        # Last in the list on purpose: the calls above need the project to
        # still be there.
        ("Video 삭제", "delete", f"/api/video/projects/{video_id}", None),
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


# ------------------------------------------------- the guard map itself

#: Every route and the guard it must carry. `None` means no guard at all.
#:
#: This is the same table as the one in `docs/architecture.md`, written so
#: a machine can check it. Adding a route, or changing one's guard, fails
#: the test below until this map is updated — which is exactly the moment
#: to think about whether the new guard is the right one.
#:
#: The bug this file came from was three endpoints silently missing a
#: guard. A list that only lived in prose would have gone stale the same
#: way.
EXPECTED_GUARDS: dict[tuple[str, str], str | None] = {
    ("GET", "/"): None,
    ("GET", "/api/health"): None,
    ("POST", "/api/auth/register"): None,
    ("POST", "/api/auth/login"): None,
    ("POST", "/api/auth/logout"): None,
    ("GET", "/api/auth/me"): "get_current_user",
    # Leaving CTRL+AI. Not participation-gated: the way out must not be
    # behind participating.
    ("GET", "/api/account/withdrawal"): "get_current_user",
    ("POST", "/api/account/withdrawal"): "get_current_user",
    # Chat — reads open (past conversations stay readable while inactive),
    # writes gated. Sending is the call that spends the Build budget.
    ("GET", "/api/chat/info"): "get_current_user",
    ("GET", "/api/chat/conversations"): "get_current_user",
    ("GET", "/api/chat/conversations/{conversation_id}"): "get_current_user",
    ("POST", "/api/chat/conversations"): "require_active_member",
    ("PATCH", "/api/chat/conversations/{conversation_id}"): "require_active_member",
    ("DELETE", "/api/chat/conversations/{conversation_id}"): "require_active_member",
    ("POST", "/api/chat/conversations/{conversation_id}/messages"): "require_active_member",
    # Builder — reads open, writes gated.
    ("GET", "/api/builder/projects"): "get_current_user",
    ("GET", "/api/builder/projects/{project_id}"): "get_current_user",
    ("POST", "/api/builder/projects"): "require_active_member",
    ("PATCH", "/api/builder/projects/{project_id}"): "require_active_member",
    ("DELETE", "/api/builder/projects/{project_id}"): "require_active_member",
    # Video — same shape; generating spends budget.
    ("GET", "/api/video/models"): "get_current_user",
    ("GET", "/api/video/projects"): "get_current_user",
    ("GET", "/api/video/projects/{project_id}"): "get_current_user",
    ("POST", "/api/video/projects"): "require_active_member",
    ("PATCH", "/api/video/projects/{project_id}"): "require_active_member",
    ("POST", "/api/video/projects/{project_id}/versions"): "require_active_member",
    ("POST", "/api/video/projects/{project_id}/versions/{version_id}/edit"): "require_active_member",
    ("POST", "/api/video/projects/{project_id}/versions/{version_id}/extend"): "require_active_member",
    ("POST", "/api/video/projects/{project_id}/prompt-help"): "require_active_member",
    ("DELETE", "/api/video/projects/{project_id}"): "require_active_member",
    # Taking a copy of your own work out. Deliberately `get_current_user`:
    # a member who did not join this quarter may not create, but their
    # work is theirs and must stay downloadable.
    ("GET", "/api/builder/projects/{project_id}/download"): "get_current_user",
    ("GET", "/api/video/projects/{project_id}/versions/{version_id}/download"): "get_current_user",
    # Quarters — applying must stay reachable while inactive, or the only
    # way out of being inactive is behind the door it unlocks.
    ("GET", "/api/quarters/current"): "get_current_user",
    ("GET", "/api/quarters/me"): "get_current_user",
    ("POST", "/api/quarters/{quarter_id}/apply"): "get_current_user",
    ("POST", "/api/quarters/applications/{application_id}/cancel"): "get_current_user",
    ("GET", "/api/quarters/me/wallet"): "get_current_user",
    ("PATCH", "/api/quarters/me/wallet"): "get_current_user",
    ("POST", "/api/quarters/me/top-ups"): "get_current_user",
    ("GET", "/api/quarters/me/top-ups"): "get_current_user",
    ("GET", "/api/usage/me"): "get_current_user",
    # Admin — role, not participation.
    ("GET", "/api/users"): "require_admin",
    ("GET", "/api/admin/quarters"): "require_admin",
    ("POST", "/api/admin/quarters"): "require_admin",
    ("PATCH", "/api/admin/quarters/{quarter_id}"): "require_admin",
    ("GET", "/api/admin/quarters/{quarter_id}/applications"): "require_admin",
    ("POST", "/api/admin/applications/{application_id}/review"): "require_admin",
    ("GET", "/api/admin/quarters/{quarter_id}/members"): "require_admin",
    ("PUT", "/api/admin/quarters/{quarter_id}/members/{user_id}"): "require_admin",
    ("PUT", "/api/admin/quarters/{quarter_id}/allocations/{user_id}"): "require_admin",
    ("PUT", "/api/admin/members/{user_id}/role"): "require_admin",
    ("GET", "/api/admin/top-ups"): "require_admin",
    ("POST", "/api/admin/top-ups/{top_up_id}/confirm"): "require_admin",
    ("GET", "/api/admin/video-models"): "require_admin",
    ("PATCH", "/api/admin/video-models/{model_id}"): "require_admin",
    ("GET", "/api/admin/audit"): "require_admin",
    # Read-only Admin screens: the dashboard and the member detail page.
    ("GET", "/api/admin/dashboard"): "require_admin",
    ("GET", "/api/admin/members/{user_id}"): "require_admin",
    ("GET", "/api/admin/stats/applications"): "require_admin",
    ("GET", "/api/admin/stats/members"): "require_admin",
    ("GET", "/api/admin/quarters-with-stats"): "require_admin",
    # External services. The check writes (it records the outcome), so it
    # is a POST — and it is still admin-only, not participation-gated.
    # Claude's prices and the exchange rate. Admin-only; both audited.
    ("GET", "/api/admin/claude-pricing"): "require_admin",
    ("PUT", "/api/admin/claude-pricing/models/{model_id}"): "require_admin",
    ("POST", "/api/admin/claude-pricing/exchange-rate"): "require_admin",
    ("GET", "/api/admin/providers"): "require_admin",
    ("POST", "/api/admin/providers/{provider}/check"): "require_admin",
    ("POST", "/api/admin/simulate-usage"): "require_admin",
    # Deleted work. Admin-only and deliberately *not* participation-gated:
    # moderating is not creating, so an admin who did not join this
    # quarter can still restore a member's project.
    ("GET", "/api/admin/deleted-items"): "require_admin",
    ("POST", "/api/admin/work/{kind}/{item_id}/restore"): "require_admin",
    ("DELETE", "/api/admin/work/{kind}/{item_id}"): "require_admin",
    # Withdrawal, from the member detail page. Audited in the service.
    ("GET", "/api/admin/members/{user_id}/withdrawal"): "require_admin",
    ("POST", "/api/admin/members/{user_id}/withdrawal"): "require_admin",
    ("POST", "/api/admin/members/{user_id}/withdrawal/restore"): "require_admin",
    ("POST", "/api/admin/members/{user_id}/withdrawal/refund"): "require_admin",
}


def actual_guards() -> dict[tuple[str, str], str | None]:
    """Read the guard off every route FastAPI registered.

    Routers are nested, so this walks the include tree rather than
    `app.routes`, and rebuilds each prefix on the way down.
    """
    import inspect

    from fastapi.routing import APIRoute

    from app.main import app

    def walk(routes, prefix=""):
        for route in routes:
            if isinstance(route, APIRoute):
                yield prefix + route.path, route
            elif type(route).__name__ == "_IncludedRouter":
                included = route.include_context
                yield from walk(
                    route.original_router.routes,
                    prefix + (getattr(included, "prefix", "") or ""),
                )
            elif hasattr(route, "routes"):
                yield from walk(route.routes, prefix)

    found: dict[tuple[str, str], str | None] = {}
    for path, route in walk(app.routes):
        guards = set()
        for parameter in inspect.signature(route.endpoint).parameters.values():
            dependency = getattr(parameter.default, "dependency", None)
            if dependency is not None:
                guards.add(dependency.__name__)
        guards -= {"get_db", "get_settings"}

        assert len(guards) <= 1, f"{path} has more than one guard: {guards}"
        guard = guards.pop() if guards else None

        for method in route.methods - {"HEAD", "OPTIONS"}:
            found[(method, path)] = guard

    return found


def test_every_route_carries_the_guard_the_table_says() -> None:
    """The access table in docs/architecture.md, enforced.

    A new route is a failure here until someone writes down which guard
    it has. That is the check the original bug needed and did not have.
    """
    actual = actual_guards()

    missing = sorted(set(EXPECTED_GUARDS) - set(actual))
    assert not missing, f"These routes are in the table but no longer exist: {missing}"

    added = sorted(set(actual) - set(EXPECTED_GUARDS))
    assert not added, (
        "New routes with no entry in EXPECTED_GUARDS. Decide the guard, add it "
        f"here and to the table in docs/architecture.md: {added}"
    )

    wrong = {
        key: (EXPECTED_GUARDS[key], actual[key])
        for key in EXPECTED_GUARDS
        if EXPECTED_GUARDS[key] != actual[key]
    }
    assert not wrong, f"Guard changed (expected, actual): {wrong}"


def test_no_write_route_is_left_on_get_current_user() -> None:
    """A standing rule, not a list: POST/PATCH/PUT/DELETE means a change.

    The exceptions are named and justified. Anything else that writes
    must be behind `require_active_member` or `require_admin`.
    """
    allowed_write_exceptions = {
        ("POST", "/api/auth/register"),
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/logout"),
        # Applying is the way out of being inactive.
        ("POST", "/api/quarters/{quarter_id}/apply"),
        ("POST", "/api/quarters/applications/{application_id}/cancel"),
        # The member's own money, which is not community budget.
        ("PATCH", "/api/quarters/me/wallet"),
        ("POST", "/api/quarters/me/top-ups"),
        # Leaving. Spends nothing, and must work for a member who is not
        # participating this quarter. The password is checked again.
        ("POST", "/api/account/withdrawal"),
    }

    offenders = [
        (method, path)
        for (method, path), guard in actual_guards().items()
        if method in {"POST", "PATCH", "PUT", "DELETE"}
        and guard in (None, "get_current_user")
        and (method, path) not in allowed_write_exceptions
    ]

    assert not offenders, (
        "These routes change something but are not gated by participation "
        f"or role: {offenders}"
    )
