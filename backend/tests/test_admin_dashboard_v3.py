"""admin-consolidation v3 (1) — the Dashboard's 처리할 일, alerts and the
header search.

What is waiting (승인 대기, 열린 신고), the automatic alerts (a wallet past
80%, the Anthropic month, the thumbnail server) and "이번 주 가장 많이 쓴
곳" — all read from rows that already exist.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AppReport, BuilderProject, FundingSource, QuarterAllocation, UsageEvent


def usage(db: Session, user, feature: str, krw: int, project_id: int | None = None) -> None:
    db.add(
        UsageEvent(
            user_id=user.id,
            funding_source=FundingSource.COMMUNITY,
            provider="claude",
            feature=feature,
            charged_krw=krw,
            builder_project_id=project_id,
        )
    )


def test_the_dashboard_lists_what_waits_and_alerts(
    client: TestClient, db_session: Session, dev_user, other_user, budgeted, participating
) -> None:
    # A member at 86% of their wallet; the dev admin at a few percent.
    db_session.add(QuarterAllocation(user_id=other_user.id, quarter_id=participating.id, budget_krw=80_000, consumed_krw=68_800))
    budgeted.consumed_krw = 1_000
    project = BuilderProject(owner_user_id=other_user.id, name="동아리 게시판", description="")
    db_session.add(project)
    db_session.flush()
    db_session.add(AppReport(project_id=project.id, reporter_id=dev_user.id, reason="광고 같아요"))
    usage(db_session, other_user, "build", 580)
    usage(db_session, other_user, "chat", 340)
    usage(db_session, dev_user, "app_ai", 80, project.id)
    db_session.commit()

    body = client.get(f"/api/admin/dashboard?quarter_id={participating.id}").json()
    assert body["open_reports"] == 1
    [alert] = body["wallet_alerts"]
    assert (alert["username"], alert["used_pct"], alert["remaining_krw"]) == (other_user.username, 86, 11_200)
    assert body["thumbnail_server"] == "off"
    assert body["anthropic_month"]["used_usd"] >= 0
    places = {place["label"]: place["pct"] for place in body["week_top"]["places"]}
    assert places == {"Project Builder": 58, "Chat": 34, "앱 AI": 8}
    assert body["week_top"]["app_name"] == "동아리 게시판" and body["week_top"]["app_krw"] == 80


def test_the_header_search_finds_members_and_apps(client: TestClient, db_session: Session, other_user) -> None:
    db_session.add(BuilderProject(owner_user_id=other_user.id, name="동아리 게시판", description=""))
    db_session.add(BuilderProject(owner_user_id=other_user.id, name="지운 게시판", description="", deleted_at=None))
    db_session.commit()
    response = client.get("/api/admin/search", params={"q": other_user.username[:4]})
    assert response.status_code == 200, response.text
    found = response.json()
    assert [m["username"] for m in found["members"]] == [other_user.username]
    apps = client.get("/api/admin/search", params={"q": "게시판"}).json()["apps"]
    assert {a["name"] for a in apps} == {"동아리 게시판", "지운 게시판"}
    assert client.get("/api/admin/search", params={"q": "  "}).json() == {"members": [], "apps": []}
    # % and _ are text, not wildcards.
    assert client.get("/api/admin/search", params={"q": "%"}).json()["members"] == []


def test_the_search_is_for_admins(other_client: TestClient) -> None:
    assert other_client.get("/api/admin/search", params={"q": "a"}).status_code == 403
