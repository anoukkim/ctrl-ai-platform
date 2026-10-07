"""Leaving CTRL+AI: withdrawal, the refund hold, 복구 and anonymisation.

The member who leaves is `other_user`, an ordinary member. The admin is
the seeded development user on a client of its own: `client` and
`other_client` are the same TestClient underneath, so signing one in signs
the other out.
"""

from collections.abc import Generator
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.jobs import anonymise_withdrawn
from app.main import app
from app.models import (
    AccountStatus,
    AccountWithdrawal,
    ApplicationStatus,
    AuditAction,
    AuditLog,
    BudgetCategory,
    BuilderProject,
    BuilderProjectStatus,
    MembershipStatus,
    PersonalTopUp,
    PublishedWorkChoice,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    QuarterMembership,
    QuarterStatus,
    RefundStatus,
    TopUpStatus,
    UsageEvent,
    User,
    UserSession,
    VideoProject,
    VideoProjectStatus,
)
from app.services import usage as usage_service
from app.services import withdrawal as withdrawal_service
from app.services.quarters import set_membership
from app.services.wallet import get_or_create_balance
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD


# ------------------------------------------------------------ fixtures


@pytest.fixture
def quarter(db_session: Session) -> Quarter:
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
    return row


@pytest.fixture
def funded_member(db_session: Session, other_user, quarter) -> QuarterAllocation:
    """`other_user` participating, with Build 70,000 / Video 30,000원."""
    set_membership(db_session, other_user.id, quarter.id, MembershipStatus.ACTIVE)
    allocation = QuarterAllocation(
        user_id=other_user.id,
        quarter_id=quarter.id,
        community_total_budget_krw=100_000,
        build_budget_krw=70_000,
        video_budget_krw=30_000,
        build_percentage=70,
        video_percentage=30,
    )
    db_session.add(allocation)
    db_session.commit()
    return allocation


@pytest.fixture
def admin_client(other_client: TestClient, dev_user) -> Generator[TestClient, None, None]:
    """A second, independent client signed in as the admin.

    Depends on `other_client` so the database override is already in
    place and the member is already signed in on the other client.
    """
    with TestClient(app) as admin:
        response = admin.post(
            "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
        )
        assert response.status_code == 200, response.text
        yield admin


def withdraw(client: TestClient, password: str = MEMBER_PASSWORD, **extra):
    return client.post("/api/account/withdrawal", json={"password": password, **extra})


def after_grace(db_session: Session, user_id: int) -> None:
    """Move the open withdrawal's grace period into the past."""
    row = withdrawal_service.open_withdrawal(db_session, user_id)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    row.withdrawn_at = past - timedelta(days=30)
    row.grace_ends_at = past
    db_session.commit()


def audit_actions(db_session: Session) -> list[str]:
    return list(db_session.scalars(select(AuditLog.action).order_by(AuditLog.id)))


# ------------------------------------------------------------ password


def test_a_wrong_password_blocks_withdrawal(
    other_client: TestClient, other_user, db_session: Session
) -> None:
    response = withdraw(other_client, password="not-the-password")

    assert response.status_code == 400
    assert response.json()["detail"] == "비밀번호가 올바르지 않습니다."
    db_session.refresh(other_user)
    assert other_user.account_status is AccountStatus.ACTIVE
    assert db_session.scalar(select(func.count(AccountWithdrawal.id))) == 0
    # Still signed in.
    assert other_client.get("/api/auth/me").status_code == 200


def test_withdrawing_requires_signing_in(anon_client: TestClient) -> None:
    assert withdraw(anon_client).status_code == 401


# ------------------------------------------------------------ effects


def test_a_withdrawn_member_is_signed_out_and_cannot_sign_in(
    other_client: TestClient, other_user, db_session: Session
) -> None:
    response = withdraw(other_client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["refund_status"] == "none"
    assert body["self_initiated"] is True
    assert body["can_restore"] is True

    db_session.refresh(other_user)
    assert other_user.account_status is AccountStatus.FORMER
    assert db_session.scalar(
        select(func.count(UserSession.id)).where(UserSession.user_id == other_user.id)
    ) == 0

    # The session is gone, so the same browser is no longer signed in...
    assert other_client.get("/api/auth/me").status_code == 401
    # ...and signing in again is refused.
    login = other_client.post(
        "/api/auth/login", json={"username": "other", "password": MEMBER_PASSWORD}
    )
    assert login.status_code == 403


def test_a_member_not_participating_can_still_withdraw(
    other_client: TestClient, other_user, quarter
) -> None:
    """The way out must not be behind participating."""
    assert withdraw(other_client).status_code == 200


def test_withdrawing_twice_is_refused(
    other_client: TestClient, admin_client: TestClient, other_user
) -> None:
    assert withdraw(other_client).status_code == 200
    again = admin_client.post(f"/api/admin/members/{other_user.id}/withdrawal", json={})
    assert again.status_code == 409


def test_remaining_club_allocation_is_released_and_audited(
    other_client: TestClient, other_user, funded_member, db_session: Session
) -> None:
    usage_service.charge(
        db_session, user=other_user, category=BudgetCategory.BUILD,
        amount_krw=10_000, provider="claude",
    )

    response = withdraw(other_client)
    assert response.status_code == 200
    assert response.json()["released_krw"] == 90_000

    db_session.refresh(funded_member)
    # Lowered to what was consumed, so nothing is left to spend and the
    # history still adds up.
    assert funded_member.build_budget_krw == 10_000
    assert funded_member.video_budget_krw == 0
    assert funded_member.community_total_budget_krw == 10_000
    assert funded_member.build_consumed_krw == 10_000
    # The approved split is history and is not rewritten.
    assert (funded_member.build_percentage, funded_member.video_percentage) == (70, 30)

    released = db_session.scalar(
        select(AuditLog).where(AuditLog.action == AuditAction.ALLOCATION_RELEASED)
    )
    assert released is not None
    assert released.target_id == funded_member.id
    assert released.detail["build_released_krw"] == 60_000
    assert released.detail["video_released_krw"] == 30_000
    assert "90,000원" in released.summary
    assert AuditAction.ACCOUNT_WITHDRAWN in audit_actions(db_session)

    # Participation ends with it.
    membership = db_session.scalar(
        select(QuarterMembership).where(QuarterMembership.user_id == other_user.id)
    )
    assert membership.status is MembershipStatus.FORMER


def test_a_closed_quarter_is_left_alone(
    other_client: TestClient, other_user, funded_member, quarter, db_session: Session
) -> None:
    """Released means *this* quarter's money, not history."""
    quarter.status = QuarterStatus.CLOSED
    db_session.commit()

    assert withdraw(other_client).json()["released_krw"] == 0
    db_session.refresh(funded_member)
    assert funded_member.build_budget_krw == 70_000


def test_a_live_application_is_cancelled(
    other_client: TestClient, other_user, quarter, db_session: Session
) -> None:
    quarter.status = QuarterStatus.APPLICATION_OPEN
    application = QuarterApplication(
        user_id=other_user.id,
        quarter_id=quarter.id,
        build_percentage=50,
        video_percentage=50,
        requested_total_budget_krw=100_000,
        requested_build_budget_krw=50_000,
        requested_video_budget_krw=50_000,
        status=ApplicationStatus.SUBMITTED,
    )
    db_session.add(application)
    db_session.commit()

    assert withdraw(other_client).status_code == 200
    db_session.refresh(application)
    assert application.status is ApplicationStatus.CANCELLED


def test_usage_history_stays_after_withdrawal(
    other_client: TestClient, other_user, funded_member, db_session: Session
) -> None:
    usage_service.charge(
        db_session, user=other_user, category=BudgetCategory.VIDEO,
        amount_krw=4_000, provider="higgsfield",
    )
    withdraw(other_client)

    events = list(db_session.scalars(select(UsageEvent).where(UsageEvent.user_id == other_user.id)))
    assert [event.charged_krw for event in events] == [4_000]


# ------------------------------------------------------------ preview


def test_the_preview_lists_what_will_happen(
    other_client: TestClient, other_user, funded_member, db_session: Session
) -> None:
    balance = get_or_create_balance(db_session, other_user.id)
    balance.balance_krw = 8_000
    db_session.add(
        BuilderProject(
            owner_user_id=other_user.id, name="앱", status=BuilderProjectStatus.PUBLISHED
        )
    )
    db_session.add(VideoProject(owner_user_id=other_user.id, name="영상"))
    db_session.commit()

    body = other_client.get("/api/account/withdrawal").json()

    assert body["released_krw"] == 100_000
    assert body["personal_remaining_krw"] == 8_000
    assert body["refund_hold"] is True
    assert body["published_apps"] == 1
    assert body["published_videos"] == 0
    assert body["builder_projects"] == 1
    assert body["video_projects"] == 1
    assert body["grace_period_days"] == 30
    assert body["quarters"] == ["2026 Q4"]
    # Looking changes nothing.
    db_session.refresh(other_user)
    assert other_user.account_status is AccountStatus.ACTIVE


# ------------------------------------------------------------ refund hold


def test_a_personal_balance_blocks_finalisation_until_a_refund_is_recorded(
    other_client: TestClient, admin_client: TestClient, other_user, db_session: Session
) -> None:
    balance = get_or_create_balance(db_session, other_user.id)
    balance.balance_krw = 20_000
    balance.consumed_krw = 5_000
    db_session.commit()

    body = withdraw(other_client).json()
    assert body["refund_status"] == "pending"
    assert body["refund_amount_krw"] == 15_000

    # Grace period over, but money is still owed: the job must not finalise.
    after_grace(db_session, other_user.id)
    result = anonymise_withdrawn.run(db_session)
    assert result.anonymised == []
    assert result.waiting_for_refund == [other_user.id]
    db_session.refresh(other_user)
    assert other_user.username == "other"

    refund = admin_client.post(
        f"/api/admin/members/{other_user.id}/withdrawal/refund",
        json={"reference": "계좌이체 1234"},
    )
    assert refund.status_code == 200, refund.text
    assert refund.json()["refund_status"] == "recorded"
    assert refund.json()["refund_amount_krw"] == 15_000
    assert refund.json()["refund_reference"] == "계좌이체 1234"

    db_session.refresh(balance)
    assert balance.remaining_krw == 0
    # Usage is usage; only what was deposited goes back.
    assert balance.consumed_krw == 5_000
    assert AuditAction.REFUND_RECORDED in audit_actions(db_session)

    # Now it can be finalised.
    assert anonymise_withdrawn.run(db_session).anonymised == [other_user.id]


def test_an_unreviewed_top_up_also_holds_the_refund(
    other_client: TestClient, admin_client: TestClient, other_user, db_session: Session
) -> None:
    """The deposit may already have been made. It is not silently dropped."""
    db_session.add(
        PersonalTopUp(user_id=other_user.id, amount_krw=10_000, status=TopUpStatus.REQUESTED)
    )
    db_session.commit()

    assert withdraw(other_client).json()["refund_status"] == "pending"

    refused = admin_client.post(f"/api/admin/members/{other_user.id}/withdrawal/refund", json={})
    assert refused.status_code == 409
    assert "충전 요청" in refused.json()["detail"]


def test_a_refund_cannot_be_recorded_when_none_is_owed(
    other_client: TestClient, admin_client: TestClient, other_user
) -> None:
    withdraw(other_client)
    response = admin_client.post(f"/api/admin/members/{other_user.id}/withdrawal/refund", json={})
    assert response.status_code == 409


# ------------------------------------------------------------ restore


def test_restore_works_within_the_grace_period(
    other_client: TestClient,
    admin_client: TestClient,
    other_user,
    funded_member,
    db_session: Session,
) -> None:
    balance = get_or_create_balance(db_session, other_user.id)
    balance.balance_krw = 3_000
    balance.overage_enabled = True
    db_session.commit()
    withdraw(other_client)

    response = admin_client.post(f"/api/admin/members/{other_user.id}/withdrawal/restore")
    assert response.status_code == 200, response.text
    assert response.json()["restored_at"] is not None
    # Back, so nothing is owed any more.
    assert response.json()["refund_status"] == "none"

    db_session.refresh(other_user)
    db_session.refresh(funded_member)
    db_session.refresh(balance)
    assert other_user.account_status is AccountStatus.ACTIVE
    assert (funded_member.build_budget_krw, funded_member.video_budget_krw) == (70_000, 30_000)
    assert funded_member.community_total_budget_krw == 100_000
    assert balance.overage_enabled is True
    membership = db_session.scalar(
        select(QuarterMembership).where(QuarterMembership.user_id == other_user.id)
    )
    assert membership.status is MembershipStatus.ACTIVE
    assert AuditAction.ACCOUNT_RESTORED in audit_actions(db_session)

    login = other_client.post(
        "/api/auth/login", json={"username": "other", "password": MEMBER_PASSWORD}
    )
    assert login.status_code == 200


def test_restore_is_refused_after_the_grace_period(
    other_client: TestClient, admin_client: TestClient, other_user, db_session: Session
) -> None:
    withdraw(other_client)
    after_grace(db_session, other_user.id)

    response = admin_client.post(f"/api/admin/members/{other_user.id}/withdrawal/restore")

    assert response.status_code == 409
    assert "30일" in response.json()["detail"]
    db_session.refresh(other_user)
    assert other_user.account_status is AccountStatus.FORMER


def test_restore_keeps_an_adjustment_made_during_the_grace_period(
    other_client: TestClient,
    admin_client: TestClient,
    other_user,
    funded_member,
    quarter,
    db_session: Session,
) -> None:
    """Released money is added back, not overwritten over a later decision."""
    withdraw(other_client)
    admin_client.put(
        f"/api/admin/quarters/{quarter.id}/allocations/{other_user.id}",
        json={"build_budget_krw": 5_000, "video_budget_krw": 0},
    )

    admin_client.post(f"/api/admin/members/{other_user.id}/withdrawal/restore")

    db_session.refresh(funded_member)
    assert (funded_member.build_budget_krw, funded_member.video_budget_krw) == (75_000, 30_000)


# ------------------------------------------------------------ anonymise


def test_anonymisation_removes_personal_fields_but_keeps_usage_totals(
    other_client: TestClient,
    admin_client: TestClient,
    other_user,
    funded_member,
    db_session: Session,
) -> None:
    usage_service.charge(
        db_session, user=other_user, category=BudgetCategory.BUILD,
        amount_krw=12_000, provider="claude",
    )
    withdraw(other_client)
    after_grace(db_session, other_user.id)

    result = anonymise_withdrawn.run(db_session)
    assert result.anonymised == [other_user.id]

    db_session.refresh(other_user)
    assert other_user.username == f"withdrawn-{other_user.id}"
    assert other_user.email == f"withdrawn-{other_user.id}@withdrawn.example.com"
    assert other_user.display_name == "탈퇴 회원"
    assert "other" not in (other_user.username, other_user.email, other_user.display_name)
    assert other_user.account_status is AccountStatus.FORMER

    # The money stays exactly where it was.
    total = db_session.scalar(
        select(func.sum(UsageEvent.charged_krw)).where(UsageEvent.user_id == other_user.id)
    )
    assert total == 12_000
    db_session.refresh(funded_member)
    assert funded_member.build_consumed_krw == 12_000

    # The old password no longer works, and neither does the old name.
    for username in ("other", other_user.username):
        login = other_client.post(
            "/api/auth/login", json={"username": username, "password": MEMBER_PASSWORD}
        )
        assert login.status_code == 401

    # Every screen that lists members still renders the anonymised row.
    assert admin_client.get("/api/users").status_code == 200
    detail = admin_client.get(f"/api/admin/members/{other_user.id}").json()
    assert detail["display_name"] == "탈퇴 회원"
    assert detail["withdrawal"]["anonymised_at"] is not None
    assert detail["withdrawal"]["can_restore"] is False

    # And it is final.
    restore = admin_client.post(f"/api/admin/members/{other_user.id}/withdrawal/restore")
    assert restore.status_code == 409


def test_the_job_is_safe_to_run_again(
    other_client: TestClient, other_user, db_session: Session
) -> None:
    withdraw(other_client)
    after_grace(db_session, other_user.id)

    assert anonymise_withdrawn.run(db_session).anonymised == [other_user.id]
    assert anonymise_withdrawn.run(db_session).anonymised == []
    assert audit_actions(db_session).count(AuditAction.ACCOUNT_ANONYMISED) == 1


def test_the_job_leaves_a_withdrawal_still_in_its_grace_period(
    other_client: TestClient, other_user, db_session: Session
) -> None:
    withdraw(other_client)
    assert anonymise_withdrawn.run(db_session).anonymised == []
    db_session.refresh(other_user)
    assert other_user.username == "other"


def test_a_dry_run_changes_nothing(
    other_client: TestClient, other_user, db_session: Session
) -> None:
    withdraw(other_client)
    after_grace(db_session, other_user.id)

    assert anonymise_withdrawn.run(db_session, dry_run=True).anonymised == [other_user.id]
    db_session.refresh(other_user)
    assert other_user.username == "other"


def test_the_anonymisation_audit_row_holds_no_personal_data(
    other_client: TestClient, other_user, db_session: Session
) -> None:
    withdraw(other_client)
    after_grace(db_session, other_user.id)
    anonymise_withdrawn.run(db_session)

    row = db_session.scalar(
        select(AuditLog).where(AuditLog.action == AuditAction.ACCOUNT_ANONYMISED)
    )
    assert row.actor_user_id is None
    for personal in ("other", "Other Member", "other@ctrl.ai"):
        assert personal not in row.summary
        assert personal != row.target_label


# ------------------------------------------------------------ published work


def published_work(db_session: Session, user: User) -> tuple[BuilderProject, VideoProject]:
    app_row = BuilderProject(
        owner_user_id=user.id, name="가계부", status=BuilderProjectStatus.PUBLISHED
    )
    video_row = VideoProject(
        owner_user_id=user.id, name="서울의 밤", status=VideoProjectStatus.PUBLISHED
    )
    db_session.add_all([app_row, video_row])
    db_session.commit()
    return app_row, video_row


def test_the_unpublish_choice_takes_work_off_ctrlaiapps_and_ctrlaitube(
    other_client: TestClient, admin_client: TestClient, other_user, db_session: Session
) -> None:
    app_row, video_row = published_work(db_session, other_user)

    response = withdraw(other_client, published_work="unpublish")
    assert response.json()["published_work"] == "unpublish"

    db_session.refresh(app_row)
    db_session.refresh(video_row)
    assert app_row.status is BuilderProjectStatus.READY
    assert video_row.status is VideoProjectStatus.READY
    # Not deleted: the member chose to take it down, not to destroy it.
    assert app_row.deleted_at is None and video_row.deleted_at is None

    # 복구 puts it back up.
    admin_client.post(f"/api/admin/members/{other_user.id}/withdrawal/restore")
    db_session.refresh(app_row)
    db_session.refresh(video_row)
    assert app_row.status is BuilderProjectStatus.PUBLISHED
    assert video_row.status is VideoProjectStatus.PUBLISHED


def test_published_work_is_kept_by_default(
    other_client: TestClient, other_user, db_session: Session
) -> None:
    app_row, video_row = published_work(db_session, other_user)

    assert withdraw(other_client).json()["published_work"] == "keep"

    db_session.refresh(app_row)
    db_session.refresh(video_row)
    assert app_row.status is BuilderProjectStatus.PUBLISHED
    assert video_row.status is VideoProjectStatus.PUBLISHED


# ------------------------------------------------------------ admin


def test_admin_initiated_withdrawal_uses_the_same_rules(
    admin_client: TestClient, other_user, funded_member, db_session: Session
) -> None:
    balance = get_or_create_balance(db_session, other_user.id)
    balance.balance_krw = 1_000
    db_session.commit()

    response = admin_client.post(
        f"/api/admin/members/{other_user.id}/withdrawal", json={"published_work": "keep"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["self_initiated"] is False
    assert body["released_krw"] == 100_000
    assert body["refund_status"] == "pending"

    db_session.refresh(other_user)
    assert other_user.account_status is AccountStatus.FORMER
    assert AuditAction.ALLOCATION_RELEASED in audit_actions(db_session)


def test_an_admin_cannot_withdraw_themselves_from_admin(
    client: TestClient, dev_user
) -> None:
    response = client.post(f"/api/admin/members/{dev_user.id}/withdrawal", json={})
    assert response.status_code == 400


def test_the_last_admin_cannot_withdraw(client: TestClient, dev_user) -> None:
    response = client.post("/api/account/withdrawal", json={"password": DEV_PASSWORD})
    assert response.status_code == 409
    assert "마지막 관리자" in response.json()["detail"]


def test_marking_former_from_participation_is_a_withdrawal(
    admin_client: TestClient, other_user, funded_member, quarter, db_session: Session
) -> None:
    """Admin's older 탈퇴 처리 must not skip the rules the new routes keep."""
    response = admin_client.put(
        f"/api/admin/quarters/{quarter.id}/members/{other_user.id}", json={"status": "former"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["account_status"] == "former"

    row = withdrawal_service.open_withdrawal(db_session, other_user.id)
    assert row is not None
    assert row.published_work is PublishedWorkChoice.KEEP
    assert row.released_krw == 100_000


def test_a_withdrawn_account_comes_back_only_through_restore(
    admin_client: TestClient, other_client: TestClient, other_user, quarter
) -> None:
    withdraw(other_client)

    response = admin_client.put(
        f"/api/admin/quarters/{quarter.id}/members/{other_user.id}", json={"status": "active"}
    )
    assert response.status_code == 409
    assert "복구" in response.json()["detail"]


def test_member_detail_shows_the_withdrawal(
    other_client: TestClient, admin_client: TestClient, other_user
) -> None:
    assert admin_client.get(f"/api/admin/members/{other_user.id}").json()["withdrawal"] is None

    withdraw(other_client)
    block = admin_client.get(f"/api/admin/members/{other_user.id}").json()["withdrawal"]

    assert block["withdrawn_at"] is not None
    assert block["grace_ends_at"] is not None
    assert block["refund_status"] == "none"
    assert block["can_restore"] is True


def test_a_member_cannot_reach_the_admin_withdrawal_routes(
    other_client: TestClient, dev_user
) -> None:
    base = f"/api/admin/members/{dev_user.id}/withdrawal"
    assert other_client.get(base).status_code == 403
    assert other_client.post(base, json={}).status_code == 403
    assert other_client.post(f"{base}/restore").status_code == 403
    assert other_client.post(f"{base}/refund", json={}).status_code == 403
