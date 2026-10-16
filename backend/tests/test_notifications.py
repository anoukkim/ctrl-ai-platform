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
    TubeVideo,
    ApplicationStatus,
    BuilderProject,
    Notification,
    QuarterApplication,
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


def test_a_spend_milestone_writes_no_notification_any_more(
    client: TestClient, db_session: Session, dev_user, budgeted
) -> None:
    """owner-polish-3 (c): the toast says it; the list keeps approvals,
    reactions and 신고 처리 only."""
    budgeted.consumed_krw = 30_000  # 30% of 100,000
    db_session.commit()
    claim = milestones.claim(db_session, dev_user)
    assert claim is not None and claim.milestone == "used_25"
    assert _titles(client) == []
    assert db_session.query(Notification).count() == 0


def test_old_spend_and_milestone_rows_are_hidden_from_the_list_and_the_badge(
    client: TestClient, db_session: Session, dev_user
) -> None:
    for kind, title in (("spend", "10월 1일 지원금 500원 사용"), ("milestone", "지원금의 25%를 썼어요")):
        db_session.add(Notification(user_id=dev_user.id, kind=kind, title=title, body="", link="/usage"))
    db_session.add(Notification(user_id=dev_user.id, kind="publish", title="'앱' 게시 완료 — v1", body="", link=None))
    db_session.commit()
    assert _titles(client) == ["'앱' 게시 완료 — v1"]
    assert client.get("/api/notifications/unread").json() == {"unread": 1}


# ------------------------------------------------------------ 반응을 얻었어요


@pytest.fixture
def my_video(db_session: Session, other_user) -> TubeVideo:
    """A video made by `other` — reactions on it reach `other`."""
    video = TubeVideo(slug="otherclip", kind="hosted", title="다른 회원의 영상", description="", creator_id=other_user.id)
    db_session.add(video)
    db_session.commit()
    return video


def test_reactions_and_comments_on_my_video_become_one_row_per_day_that_counts_up(
    client: TestClient, db_session: Session, dev_user, other_user, participating, other_participating, my_video: TubeVideo
) -> None:
    # The dev user reacts and comments on other's video.
    assert client.post(f"/api/tube/videos/{my_video.slug}/reactions", json={"kind": "like"}).status_code == 200
    first = client.post(f"/api/tube/videos/{my_video.slug}/comments", json={"body": "멋져요!"})
    assert first.status_code == 201
    # Nothing for the actor themselves; one grouped row for the maker.
    assert _titles(client) == []
    rows = db_session.query(Notification).filter_by(user_id=other_user.id).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.kind == "reaction" and row.title == "'다른 회원의 영상'이(가) 오늘 반응 2개를 얻었어요"
    assert row.body == "방금: 댓글" and row.link == "/ctrlaitube/otherclip" and row.read_at is None

    # Read, then another reaction: the same row, counted up and unread again.
    row.read_at = datetime.now(timezone.utc)
    db_session.commit()
    assert client.post(f"/api/tube/videos/{my_video.slug}/reactions", json={"kind": "useful"}).status_code == 200
    db_session.expire_all()
    row = db_session.query(Notification).filter_by(user_id=other_user.id).one()
    assert row.title.endswith("반응 3개를 얻었어요") and row.body == "방금: 유용해요" and row.read_at is None

    # Other answers dev's comment: dev hears of the reply (one row for that comment).
    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    reply = client.post(f"/api/tube/videos/{my_video.slug}/comments", json={"body": "고마워요", "parent_id": first.json()["id"]})
    assert reply.status_code == 201
    mine = db_session.query(Notification).filter_by(user_id=dev_user.id).one()
    assert mine.kind == "reaction" and mine.title == "'멋져요!'이(가) 오늘 반응 1개를 얻었어요" and mine.body == "방금: 답글"
    # The maker's own reply on their own video adds nothing for themselves.
    assert db_session.query(Notification).filter_by(user_id=other_user.id).count() == 1


def test_the_clubs_own_video_has_no_maker_to_tell(client: TestClient, db_session: Session, participating) -> None:
    from app.services import tube

    assert client.post(f"/api/tube/videos/{tube.OFFICIAL_SLUG}/reactions", json={"kind": "like"}).status_code == 200
    assert db_session.query(Notification).count() == 0


def test_clearing_deletes_the_shown_rows_or_everything(client: TestClient, db_session: Session, dev_user, other_user) -> None:
    for n in range(3):
        db_session.add(Notification(user_id=dev_user.id, kind="publish", title=f"'앱 {n}' 게시 완료 — v1", body="", link=None))
    db_session.add(Notification(user_id=other_user.id, kind="publish", title="남의 것", body="", link=None))
    db_session.commit()
    ids = [row["id"] for row in client.get("/api/notifications").json()["items"]]
    assert len(ids) == 3

    # The shown ones (two of three), never another member's.
    others = [row.id for row in db_session.query(Notification).filter_by(user_id=other_user.id)]
    cleared = client.post("/api/notifications/clear", json={"ids": ids[:2] + others})
    assert cleared.status_code == 200 and cleared.json() == {"unread": 1}
    assert len(client.get("/api/notifications").json()["items"]) == 1
    assert db_session.query(Notification).filter_by(user_id=other_user.id).count() == 1

    # Everything of mine.
    assert client.post("/api/notifications/clear", json={}).json() == {"unread": 0}
    assert client.get("/api/notifications").json()["items"] == []
    assert db_session.query(Notification).filter_by(user_id=other_user.id).count() == 1


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
