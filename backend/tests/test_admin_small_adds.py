"""admin-consolidation v3 (4) — 비밀번호 재설정, 공지 띠, 알림 기준, 백업 상태."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import record_backup
from app.main import app
from app.models import AccountStatus, AuditLog, BackupRun, QuarterAllocation
from app.services import backups, site_settings

from tests.conftest import JSON_HEADERS, MEMBER_PASSWORD


def test_an_admin_resets_a_members_password(client: TestClient, db_session: Session, other_user) -> None:
    with TestClient(app, headers=JSON_HEADERS) as member:
        assert member.post("/api/auth/login", json={"username": "other", "password": MEMBER_PASSWORD}).status_code == 200
        assert member.get("/api/auth/me").status_code == 200

        # A JSON body that says so; nothing changes without it.
        assert client.post(f"/api/admin/members/{other_user.id}/password-reset", json={}).status_code == 400
        response = client.post(f"/api/admin/members/{other_user.id}/password-reset", json={"confirm": True})
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        body = response.json()
        temporary = body["temporary_password"]
        assert len(temporary) == 19 and body["sessions_ended"] == 1

        # The member's open session is gone; the old password no longer works, the new one does.
        assert member.get("/api/auth/me").status_code == 401
        assert member.post("/api/auth/login", json={"username": "other", "password": MEMBER_PASSWORD}).status_code == 401
        assert member.post("/api/auth/login", json={"username": "other", "password": temporary}).status_code == 200

    row = db_session.scalar(select(AuditLog).where(AuditLog.action == "account.password_reset_by_admin"))
    assert row is not None and row.target_id == other_user.id
    # The audit row never holds the password.
    assert temporary not in (row.summary + str(row.detail))


def test_password_reset_refuses_self_and_former(client: TestClient, db_session: Session, dev_user, other_user) -> None:
    assert client.post(f"/api/admin/members/{dev_user.id}/password-reset", json={"confirm": True}).status_code == 400
    other_user.account_status = AccountStatus.FORMER
    db_session.commit()
    assert client.post(f"/api/admin/members/{other_user.id}/password-reset", json={"confirm": True}).status_code == 409
    assert client.post("/api/admin/members/99999/password-reset", json={"confirm": True}).status_code == 404


def test_the_banner_follows_the_admin(client: TestClient, db_session: Session) -> None:
    # No saved setting: the strip is the beta's (the tests run as development).
    site = client.get("/api/site").json()["banner"]
    assert site == {"shown": False, "text": site_settings.DEFAULT_BANNER_TEXT, "feedback_link": True}

    put = client.put("/api/admin/site/banner", json={"shown": True, "text": "  10월 25일 점검이 있어요  ", "feedback_link": False})
    assert put.status_code == 200 and put.json()["set_by_username"] == "dev"
    assert client.get("/api/site").json()["banner"] == {"shown": True, "text": "10월 25일 점검이 있어요", "feedback_link": False}

    # An empty text means the default sentence; hiding is a switch, not a deploy.
    client.put("/api/admin/site/banner", json={"shown": False, "text": "", "feedback_link": True})
    assert client.get("/api/site").json()["banner"]["text"] == site_settings.DEFAULT_BANNER_TEXT
    assert client.get("/api/site").json()["banner"]["shown"] is False
    assert db_session.scalar(select(AuditLog).where(AuditLog.action == "site.banner_set")) is not None

    too_long = "가" * (site_settings.BANNER_MAX + 1)
    assert client.put("/api/admin/site/banner", json={"shown": True, "text": too_long}).status_code == 422


def test_alert_thresholds_move_the_dashboard(client: TestClient, db_session: Session, dev_user, participating) -> None:
    db_session.add(QuarterAllocation(user_id=dev_user.id, quarter_id=participating.id, budget_krw=80_000, consumed_krw=56_000))
    db_session.commit()
    # 70% used: under the default 80%.
    assert client.get("/api/admin/dashboard").json()["wallet_alerts"] == []

    put = client.put("/api/admin/alert-thresholds", json={"wallet_pct": 70, "month_pct": 90, "backup_hours": 24})
    assert put.status_code == 200
    dashboard = client.get("/api/admin/dashboard").json()
    assert [alert["user_id"] for alert in dashboard["wallet_alerts"]] == [dev_user.id]
    assert dashboard["alert_thresholds"] == {"wallet_pct": 70, "month_pct": 90, "backup_hours": 24}

    refused = client.put("/api/admin/alert-thresholds", json={"wallet_pct": 10, "month_pct": 90, "backup_hours": 24})
    assert refused.status_code == 422 and "50–100" in refused.json()["detail"]


def test_backups_are_recorded_and_late(client: TestClient, db_session: Session, monkeypatch) -> None:
    status = client.get("/api/admin/backups").json()
    assert [line["late"] for line in status["lines"]] == [True, True] and status["late_after_hours"] == 48

    backups.record(db_session, "local", "ctrlai-20261017-031500.sql.gz", 48_000)
    db_session.commit()
    [local, offsite] = client.get("/api/admin/backups").json()["lines"]
    assert local["file_name"] == "ctrlai-20261017-031500.sql.gz" and local["late"] is False
    assert offsite["late"] is True

    later = datetime.now(timezone.utc) + timedelta(hours=49)
    assert backups.status(db_session, 48, now=later)[0].late is True


def test_record_backup_refuses_odd_input(db_session: Session, monkeypatch) -> None:
    monkeypatch.setattr(record_backup, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    assert record_backup.main(["local", "../../etc/passwd", "10"]) == 1
    assert record_backup.main(["nightly", "ctrlai-20261017-031500.sql.gz", "10"]) == 1
    assert record_backup.main(["local", "ctrlai-20261017-031500.sql.gz"]) == 2
    assert record_backup.main(["offsite", "ctrlai-20261017-031500.sql.gz", "123"]) == 0
    assert db_session.scalar(select(BackupRun.kind)) == "offsite"


def test_the_small_adds_are_for_admins(other_client: TestClient, dev_user) -> None:
    assert other_client.post(f"/api/admin/members/{dev_user.id}/password-reset", json={"confirm": True}).status_code == 403
    assert other_client.put("/api/admin/site/banner", json={"shown": False}).status_code == 403
    assert other_client.get("/api/admin/backups").status_code == 403
