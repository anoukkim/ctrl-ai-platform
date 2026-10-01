"""Quarter participation: applying, approval, and personal money.

The rules worth proving are that credits are never automatic, that the
community subsidy cannot be exceeded, and that personal money is only ever
spent on purpose.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    ApplicationStatus,
    PersonalBalance,
    Quarter,
    QuarterAllocation,
    QuarterStatus,
    User,
)


@pytest.fixture
def open_quarter(db_session: Session) -> Quarter:
    """A quarter accepting applications, with the default 100,000 KRW limit."""
    quarter = Quarter(
        code="2026-Q4",
        display_name="2026 Q4",
        starts_at=date(2026, 10, 1),
        ends_at=date(2026, 12, 31),
        application_opens_at=date(2026, 9, 15),
        application_closes_at=date(2026, 9, 30),
        status=QuarterStatus.APPLICATION_OPEN,
        subsidy_limit_krw=100_000,
    )
    db_session.add(quarter)
    db_session.commit()
    db_session.refresh(quarter)
    return quarter


def test_a_member_starts_with_no_allocation(
    client: TestClient, dev_user: User, open_quarter: Quarter
) -> None:
    """Credits are not automatic — applying is required."""
    body = client.get("/api/quarters/me").json()

    assert body["participation"] == "신청 가능"
    assert body["allocation"] is None


@pytest.mark.parametrize(
    ("build", "video", "expected_build", "expected_video"),
    [
        (100, 0, 100_000, 0),
        (70, 30, 70_000, 30_000),
        (50, 50, 50_000, 50_000),
        (20, 80, 20_000, 80_000),
        (0, 100, 0, 100_000),
    ],
)
def test_applying_stores_the_requested_amounts(
    client: TestClient,
    dev_user: User,
    open_quarter: Quarter,
    build: int,
    video: int,
    expected_build: int,
    expected_video: int,
) -> None:
    response = client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": build, "video_percentage": video},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["requested_build_budget_krw"] == expected_build
    assert body["requested_video_budget_krw"] == expected_video
    assert body["requested_total_budget_krw"] == 100_000
    assert body["status"] == ApplicationStatus.SUBMITTED.value


@pytest.mark.parametrize(("build", "video"), [(70, 20), (60, 60), (0, 0)])
def test_a_split_that_is_not_100_percent_is_refused(
    client: TestClient, dev_user: User, open_quarter: Quarter, build: int, video: int
) -> None:
    response = client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": build, "video_percentage": video},
    )

    assert response.status_code == 400


def test_the_client_cannot_ask_for_more_than_the_limit(
    client: TestClient, dev_user: User, open_quarter: Quarter
) -> None:
    """Amounts are derived on the backend, never taken from the request."""
    response = client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={
            "build_percentage": 50,
            "video_percentage": 50,
            "requested_total_budget_krw": 10_000_000,
        },
    )

    assert response.status_code == 201
    assert response.json()["requested_total_budget_krw"] == 100_000


def test_cannot_apply_twice_to_the_same_quarter(
    client: TestClient, dev_user: User, open_quarter: Quarter
) -> None:
    client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": 50, "video_percentage": 50},
    )
    second = client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": 70, "video_percentage": 30},
    )

    assert second.status_code == 409


def test_cannot_apply_when_the_window_is_closed(
    client: TestClient, db_session: Session, dev_user: User, open_quarter: Quarter
) -> None:
    open_quarter.status = QuarterStatus.CLOSED
    db_session.commit()

    response = client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": 50, "video_percentage": 50},
    )

    assert response.status_code == 400


def test_approval_creates_the_allocation(
    client: TestClient, db_session: Session, dev_user: User, open_quarter: Quarter
) -> None:
    application = client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": 70, "video_percentage": 30},
    ).json()

    reviewed = client.post(
        f"/api/admin/applications/{application['id']}/review",
        json={"approve": True, "admin_note": "승인합니다."},
    ).json()

    assert reviewed["status"] == ApplicationStatus.APPROVED.value

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.build_budget_krw == 70_000
    assert allocation.video_budget_krw == 30_000
    assert allocation.build_remaining_krw == 70_000
    assert allocation.approved_at is not None

    status_body = client.get("/api/quarters/me").json()
    assert status_body["participation"] == "활동 회원"


def test_rejection_creates_no_allocation(
    client: TestClient, db_session: Session, dev_user: User, open_quarter: Quarter
) -> None:
    application = client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": 50, "video_percentage": 50},
    ).json()

    client.post(
        f"/api/admin/applications/{application['id']}/review",
        json={"approve": False, "admin_note": "이번 분기는 어렵습니다."},
    )

    assert db_session.query(QuarterAllocation).count() == 0
    assert client.get("/api/quarters/me").json()["participation"] == "신청 거절"


def test_waiting_for_review_is_shown_as_such(
    client: TestClient, dev_user: User, open_quarter: Quarter
) -> None:
    client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": 60, "video_percentage": 40},
    )

    assert client.get("/api/quarters/me").json()["participation"] == "승인 대기"


# ---------------------------------------------------------------------
# Personal money
# ---------------------------------------------------------------------


def test_personal_spending_is_off_until_the_member_turns_it_on(
    client: TestClient, dev_user: User
) -> None:
    assert client.get("/api/quarters/me/wallet").json()["overage_enabled"] is False

    body = client.patch("/api/quarters/me/wallet", json={"overage_enabled": True}).json()

    assert body["overage_enabled"] is True


def test_a_top_up_request_alone_does_not_add_money(
    client: TestClient, dev_user: User
) -> None:
    client.post("/api/quarters/me/top-ups", json={"amount_krw": 30_000})

    assert client.get("/api/quarters/me/wallet").json()["balance_krw"] == 0


def test_an_admin_confirmation_adds_the_money(
    client: TestClient, db_session: Session, dev_user: User
) -> None:
    top_up = client.post("/api/quarters/me/top-ups", json={"amount_krw": 30_000}).json()

    client.post(
        f"/api/admin/top-ups/{top_up['id']}/confirm",
        json={"confirm": True, "payment_reference": "입금 확인"},
    )

    wallet = client.get("/api/quarters/me/wallet").json()
    assert wallet["balance_krw"] == 30_000
    assert wallet["remaining_krw"] == 30_000


def test_a_rejected_top_up_adds_nothing(client: TestClient, dev_user: User) -> None:
    top_up = client.post("/api/quarters/me/top-ups", json={"amount_krw": 30_000}).json()

    client.post(f"/api/admin/top-ups/{top_up['id']}/confirm", json={"confirm": False})

    assert client.get("/api/quarters/me/wallet").json()["balance_krw"] == 0


def test_personal_money_is_not_part_of_the_community_subsidy(
    client: TestClient, db_session: Session, dev_user: User, open_quarter: Quarter
) -> None:
    """Topping up must never raise the community allocation."""
    application = client.post(
        f"/api/quarters/{open_quarter.id}/apply",
        json={"build_percentage": 50, "video_percentage": 50},
    ).json()
    client.post(f"/api/admin/applications/{application['id']}/review", json={"approve": True})

    top_up = client.post("/api/quarters/me/top-ups", json={"amount_krw": 50_000}).json()
    client.post(f"/api/admin/top-ups/{top_up['id']}/confirm", json={"confirm": True})

    allocation = db_session.query(QuarterAllocation).one()
    assert allocation.community_total_budget_krw == 100_000

    balance = db_session.query(PersonalBalance).one()
    assert balance.balance_krw == 50_000
