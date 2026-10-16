"""feat-notifications (owner-polish 2) — a member's own notification list.

Rows come only from things that happened: 게시 (and 업데이트 게시), the
admin's 참여 신청 review, an app taken down or a report closed, spend
milestones, and one spend summary per KST day written from the ledger
when the member looks. Reading and marking read are open to any
signed-in account; another member's row is a 404; old rows go.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    ApplicationStatus,
    BuilderProject,
    FundingSource,
    Notification,
    QuarterApplication,
    UsageEvent,
)
from app.services import milestones, notifications
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD


@pytest.fixture
def config(tmp_path):
    settings = Settings(
        app_env="development",
        chat_mock_delay_ms=0,
        apps_dir=str(tmp_path / "apps"),
        apps_base_url="http://apps.test",
        storage_dir=str(tmp_path / "storage"),
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def _sign_in(client: TestClient, username: str, password: str) -> None:
    client.post("/api/auth/logout", json={})
    assert client.post("/api/auth/login", json={"username": username, "password": password}).status_code == 200


def _titles(client: TestClient) -> list[str]:
    listed = client.get("/api/notifications")
    assert listed.status_code == 200, listed.text
    return [row["title"] for row in listed.json()["items"]]


# ------------------------------------------------------------ events


def test_publishing_and_updating_write_one_row_each_for_the_owner(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    assert client.get("/api/notifications").json() == {"items": [], "unread": 0}
    project = BuilderProject(owner_user_id=dev_user.id, name="오늘 할 일", description="")
    db_session.add(project)
    db_session.commit()
    assert client.post(f"/api/builder/projects/{project.id}/generate", json={"request": "할 일 앱", "style": ""}).status_code == 200
    assert client.post(f"/api/builder/projects/{project.id}/publish", json={"description": "할 일 앱이에요.", "note": ""}).status_code == 200
    titles = _titles(client)
    assert titles == ["'오늘 할 일' 게시 완료 — v1"]
    assert client.get("/api/notifications/unread").json() == {"unread": 1}
    [row] = client.get("/api/notifications").json()["items"]
    assert row["kind"] == "publish" and row["read_at"] is None
    db_session.refresh(project)
    assert row["link"] == f"/ctrlaistore/{project.app_slug}"

    # A change and 업데이트 게시: a second row, worded as an update.
    assert client.post(f"/api/builder/projects/{project.id}/generate", json={"request": "색을 바꿔 줘", "style": ""}).status_code == 200
    assert client.post(f"/api/builder/projects/{project.id}/publish", json={"description": "할 일 앱이에요.", "note": "색"}).status_code == 200
    assert _titles(client)[0] == "'오늘 할 일' 업데이트 게시 완료 — v2"


def test_the_admin_review_tells_the_applicant(
    client: TestClient, db_session: Session, dev_user, other_user, participating
) -> None:
    quarter = participating
    application = QuarterApplication(
        user_id=other_user.id, quarter_id=quarter.id, requested_budget_krw=80_000,
        status=ApplicationStatus.SUBMITTED,
    )
    db_session.add(application)
    db_session.commit()
    # dev is the admin here.
    assert client.post(f"/api/admin/applications/{application.id}/review", json={"approve": True}).status_code == 200
    # The admin's own list has nothing; the applicant's has the approval.
    assert _titles(client) == []
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    [title] = _titles(client)
    assert title == f"{quarter.display_name} 참여 신청이 승인됐어요"
    [row] = client.get("/api/notifications").json()["items"]
    assert row["kind"] == "application" and "80,000원" in row["body"] and row["link"] == "/usage"


def test_a_rejection_carries_the_admin_note(
    client: TestClient, db_session: Session, dev_user, other_user, participating
) -> None:
    application = QuarterApplication(
        user_id=other_user.id, quarter_id=participating.id, requested_budget_krw=80_000,
        status=ApplicationStatus.SUBMITTED,
    )
    db_session.add(application)
    db_session.commit()
    assert client.post(
        f"/api/admin/applications/{application.id}/review", json={"approve": False, "admin_note": "다음 분기에 다시"}
    ).status_code == 200
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    [row] = client.get("/api/notifications").json()["items"]
    assert "거절" in row["title"] and row["body"] == "다음 분기에 다시"


def test_an_app_taken_down_by_the_admin_tells_the_maker_with_the_reason(
    client: TestClient, db_session: Session, dev_user, other_user, budgeted, config
) -> None:
    project = BuilderProject(owner_user_id=dev_user.id, name="가계부", description="")
    db_session.add(project)
    db_session.commit()
    assert client.post(f"/api/builder/projects/{project.id}/generate", json={"request": "가계부", "style": ""}).status_code == 200
    assert client.post(f"/api/builder/projects/{project.id}/publish", json={"description": "가계부예요.", "note": ""}).status_code == 200
    db_session.refresh(project)
    # Another member reports it; the admin (dev) closes the report keeping the app, then takes it down.
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    assert client.post(f"/api/apps/{project.app_slug}/report", json={"reason": "이상해요"}).status_code == 201
    _sign_in(client, "dev", DEV_PASSWORD)
    reports = client.get("/api/admin/apps/reports").json()
    report_id = reports[0]["id"] if isinstance(reports, list) else reports["items"][0]["id"]
    assert client.post(f"/api/admin/apps/reports/{report_id}/resolve", json={"note": ""}).status_code == 200
    assert client.post(f"/api/admin/apps/{project.id}/unpublish", json={"reason": "비밀번호를 묻는 화면"}).status_code == 200
    titles = _titles(client)
    assert titles[0] == "'가계부'이(가) CtrlAIApps에서 내려갔어요 (v1)"
    assert titles[1] == "'가계부'에 들어온 신고를 확인했어요"
    rows = client.get("/api/notifications").json()["items"]
    assert rows[0]["body"] == "관리자 사유: 비밀번호를 묻는 화면" and rows[0]["link"] == f"/builder/{project.id}"


def test_the_approval_figure_is_the_wallets_including_earlier_adjustments(
    client: TestClient, db_session: Session, dev_user, other_user, participating
) -> None:
    """A re-approval keeps an admin's earlier +5,000 (a WalletAdjustment
    row); the member is told the wallet's figure, not the request's."""
    from app.models import QuarterAllocation, WalletAdjustment

    quarter = participating
    allocation = QuarterAllocation(user_id=other_user.id, quarter_id=quarter.id, budget_krw=80_000, consumed_krw=0)
    db_session.add(allocation)
    db_session.flush()
    db_session.add(
        WalletAdjustment(
            allocation_id=allocation.id, user_id=other_user.id, quarter_id=quarter.id, amount_krw=5_000,
            reason="보너스", budget_before_krw=80_000, budget_after_krw=85_000, created_by=dev_user.id,
        )
    )
    application = QuarterApplication(
        user_id=other_user.id, quarter_id=quarter.id, requested_budget_krw=80_000,
        status=ApplicationStatus.SUBMITTED,
    )
    db_session.add(application)
    db_session.commit()
    assert client.post(f"/api/admin/applications/{application.id}/review", json={"approve": True}).status_code == 200
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    [row] = client.get("/api/notifications").json()["items"]
    assert "85,000원" in row["body"]


def test_the_example_app_importer_writes_no_notification(
    client: TestClient, db_session: Session, dev_user, budgeted, config
) -> None:
    from app.db import import_example_apps

    import_example_apps.import_examples(db_session, dev_user, config)
    assert client.get("/api/notifications").json()["items"] == []


def test_a_spend_milestone_is_also_a_notification_once_per_quarter(
    client: TestClient, db_session: Session, dev_user, budgeted
) -> None:
    budgeted.consumed_krw = 30_000  # 30% of 100,000
    db_session.commit()
    claim = milestones.claim(db_session, dev_user)
    assert claim is not None and claim.milestone == "used_25"
    titles = _titles(client)
    assert "지원금의 25%를 썼어요" in titles and "지원금을 처음 썼어요" in titles
    # Claiming again writes nothing new.
    milestones.claim(db_session, dev_user)
    assert len(_titles(client)) == 2


# ------------------------------------------------------------ spend summaries


def _charge(db: Session, user_id: int, quarter_id: int, feature: str, krw: int, at: datetime) -> None:
    row = UsageEvent(
        user_id=user_id, quarter_id=quarter_id, funding_source=FundingSource.COMMUNITY,
        provider="claude", feature=feature, charged_krw=krw,
    )
    db.add(row)
    db.flush()
    row.created_at = at
    db.commit()


def test_yesterdays_spending_becomes_one_summary_row_written_once(
    client: TestClient, db_session: Session, dev_user, budgeted
) -> None:
    now = datetime.now(timezone.utc)
    yesterday_noon_kst = (now.astimezone(notifications.KST) - timedelta(days=1)).replace(hour=12, minute=0)
    _charge(db_session, dev_user.id, budgeted.quarter_id, "chat", 120, yesterday_noon_kst)
    _charge(db_session, dev_user.id, budgeted.quarter_id, "chat", 80, yesterday_noon_kst + timedelta(hours=1))
    _charge(db_session, dev_user.id, budgeted.quarter_id, "build", 300, yesterday_noon_kst + timedelta(hours=2))
    # Today's charge waits for tomorrow; a free call never counts.
    _charge(db_session, dev_user.id, budgeted.quarter_id, "chat", 50, now)
    _charge(db_session, dev_user.id, budgeted.quarter_id, "chat", 0, yesterday_noon_kst)

    [row] = client.get("/api/notifications").json()["items"]
    yesterday = yesterday_noon_kst.date()
    assert row["kind"] == "spend" and row["title"] == f"{yesterday.month}월 {yesterday.day}일 지원금 500원 사용"
    assert row["body"] == "채팅 2회 · 빌더 1회" and row["link"] == "/usage"
    # A second read writes nothing more (dedupe per day); the bell's count
    # route writes the summary too, so the badge can announce it.
    assert len(client.get("/api/notifications").json()["items"]) == 1
    assert db_session.query(Notification).filter_by(kind="spend").count() == 1
    db_session.query(Notification).delete()
    db_session.commit()
    assert client.get("/api/notifications/unread").json() == {"unread": 1}


def test_spend_summaries_follow_the_profile_switch_and_an_old_day_is_named(
    client: TestClient, db_session: Session, dev_user, budgeted
) -> None:
    now = datetime.now(timezone.utc)
    three_days = (now.astimezone(notifications.KST) - timedelta(days=3)).replace(hour=9, minute=0)
    _charge(db_session, dev_user.id, budgeted.quarter_id, "video_generate", 700, three_days)
    dev_user.spend_notifications = False
    db_session.commit()
    assert client.get("/api/notifications").json()["items"] == []
    dev_user.spend_notifications = True
    db_session.commit()
    [row] = client.get("/api/notifications").json()["items"]
    assert row["title"] == f"{three_days.month}월 {three_days.day}일 지원금 700원 사용"
    assert row["body"] == "영상 1회"


# ------------------------------------------------------------ reading


def test_mark_read_mark_all_read_and_nobody_elses_rows(
    client: TestClient, db_session: Session, dev_user, other_user
) -> None:
    mine = notifications.notify(db_session, dev_user.id, "publish", "내 것")
    theirs = notifications.notify(db_session, other_user.id, "publish", "남의 것")
    second = notifications.notify(db_session, dev_user.id, "publish", "내 것 둘")
    db_session.commit()
    assert client.get("/api/notifications/unread").json() == {"unread": 2}
    assert _titles(client) == ["내 것 둘", "내 것"]

    read = client.post(f"/api/notifications/{mine.id}/read", json={})
    assert read.status_code == 200 and read.json()["read_at"] is not None
    assert client.get("/api/notifications/unread").json() == {"unread": 1}
    # Someone else's: 404, unchanged.
    assert client.post(f"/api/notifications/{theirs.id}/read", json={}).status_code == 404
    assert client.post("/api/notifications/999999/read", json={}).status_code == 404
    db_session.refresh(theirs)
    assert theirs.read_at is None
    # JSON-body rule.
    assert client.post(f"/api/notifications/{second.id}/read", content="x", headers={"Content-Type": "text/plain"}).status_code in (415, 422)

    assert client.post("/api/notifications/read-all", json={}).json() == {"unread": 0}
    db_session.refresh(second)
    assert second.read_at is not None
    db_session.refresh(theirs)
    assert theirs.read_at is None


def test_rows_older_than_90_days_go_on_the_next_read(
    client: TestClient, db_session: Session, dev_user
) -> None:
    old = notifications.notify(db_session, dev_user.id, "publish", "옛날")
    fresh = notifications.notify(db_session, dev_user.id, "publish", "최근")
    db_session.flush()
    old.created_at = datetime.now(timezone.utc) - timedelta(days=notifications.KEEP_DAYS + 1)
    fresh.created_at = datetime.now(timezone.utc) - timedelta(days=notifications.KEEP_DAYS - 1)
    db_session.commit()
    assert _titles(client) == ["최근"]
    assert db_session.get(Notification, old.id) is None


def test_reading_works_for_a_member_not_taking_part(client: TestClient, db_session: Session, dev_user) -> None:
    notifications.notify(db_session, dev_user.id, "application", "지난 분기")
    db_session.commit()
    assert client.get("/api/notifications").status_code == 200
    assert client.post("/api/notifications/read-all", json={}).status_code == 200
