"""owner-polish-3 (b) — the USD→KRW rate refreshed automatically.

Mock provider throughout (no network): applied on the first run, unchanged
on the second, a jump over 5% held back with a warning and an audit row,
a failed fetch keeping the last rate, the admin's pin switch, a typed-in
rate pinning by itself, and the Frankfurter parser on a fake response.
Money: only new charges use a new rate (each usage event keeps its own).
"""

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import AuditLog, ExchangeRate, FxStatus
from app.services import fx, pricing
from tests.conftest import MEMBER_PASSWORD


@pytest.fixture
def config():
    settings = Settings(app_env="development", chat_mock_delay_ms=0)
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def mock_rate(monkeypatch):
    """What the mock provider quotes — tests move it."""
    state = {"rate": Decimal("1385.00")}
    monkeypatch.setattr(fx, "get_fx_provider", lambda settings: fx.MockFxProvider(state["rate"]))
    return state


def rates(db: Session) -> list[tuple[Decimal, str]]:
    rows = db.query(ExchangeRate).order_by(ExchangeRate.id).all()
    return [(Decimal(r.krw_per_unit), r.source) for r in rows]


def test_the_first_refresh_applies_the_rate_and_the_second_changes_nothing(
    db_session: Session, config, mock_rate
) -> None:
    pricing.seed_defaults(db_session)
    db_session.commit()
    before = rates(db_session)

    first = fx.refresh(db_session, config)
    db_session.commit()
    assert first.outcome == "applied" and first.rate == Decimal("1385.00")
    assert rates(db_session) == before + [(Decimal("1385.00"), "mock")]
    assert Decimal(pricing.current_rate(db_session).krw_per_unit) == Decimal("1385.00")
    row = db_session.query(AuditLog).filter_by(action="exchange_rate.auto").one()
    assert "1,385" in row.summary and row.actor_user_id is None
    status = db_session.get(FxStatus, 1)
    assert status.outcome == "applied" and status.checked_at is not None and status.fetched_rate == Decimal("1385.00")

    second = fx.refresh(db_session, config)
    db_session.commit()
    assert second.outcome == "unchanged"
    assert rates(db_session) == before + [(Decimal("1385.00"), "mock")]
    assert db_session.query(AuditLog).filter_by(action="exchange_rate.auto").count() == 1


def test_a_jump_over_five_percent_is_held_back_with_a_warning(db_session: Session, config, mock_rate) -> None:
    pricing.seed_defaults(db_session)
    fx.refresh(db_session, config)
    db_session.commit()

    mock_rate["rate"] = Decimal("1500.00")  # +8.3%
    held = fx.refresh(db_session, config)
    db_session.commit()
    assert held.outcome == "blocked"
    assert Decimal(pricing.current_rate(db_session).krw_per_unit) == Decimal("1385.00")
    status = db_session.get(FxStatus, 1)
    assert status.outcome == "blocked" and "8.3%" in status.note and "반영하지 않았어요" in status.note
    assert status.fetched_rate == Decimal("1500.00")
    row = db_session.query(AuditLog).filter_by(action="exchange_rate.blocked").one()
    assert row.detail["jump_pct"] == "8.3"

    # A move inside the limit goes through and clears the warning.
    mock_rate["rate"] = Decimal("1440.00")  # +4.0%
    assert fx.refresh(db_session, config).outcome == "applied"
    db_session.commit()
    assert db_session.get(FxStatus, 1).note == ""


def test_a_failed_fetch_keeps_the_last_rate(db_session: Session, config, monkeypatch) -> None:
    pricing.seed_defaults(db_session)
    db_session.commit()
    before = Decimal(pricing.current_rate(db_session).krw_per_unit)

    class Broken:
        def fetch(self):
            raise fx.FxError("환율 서버에 닿지 못했어요. 마지막 환율을 그대로 씁니다.", "ConnectError")

    monkeypatch.setattr(fx, "get_fx_provider", lambda settings: Broken())
    result = fx.refresh(db_session, config)
    db_session.commit()
    assert result.outcome == "failed" and "마지막 환율" in result.message
    assert Decimal(pricing.current_rate(db_session).krw_per_unit) == before
    assert db_session.get(FxStatus, 1).outcome == "failed"


def test_the_admin_pins_a_rate_by_typing_it_and_the_switch_turns_the_refresh_back_on(
    client: TestClient, db_session: Session, config, mock_rate
) -> None:
    settings = client.get("/api/admin/claude-pricing").json()
    assert settings["fx"]["auto_enabled"] is True and settings["fx"]["is_mock"] is True
    assert settings["fx"]["max_jump_pct"] == "5"

    pinned = client.post("/api/admin/claude-pricing/exchange-rate", json={"krw_per_usd": "1300"})
    assert pinned.status_code == 200
    assert pinned.json()["fx"]["auto_enabled"] is False
    assert pinned.json()["exchange_rate"]["source"] == "admin"
    assert "자동 반영 꺼짐" in db_session.query(AuditLog).filter_by(action="exchange_rate.set").one().summary

    # While pinned the refresh fetches nothing and 지금 새로 고침 says so.
    assert fx.refresh(db_session, config).outcome == "paused"
    assert client.post("/api/admin/claude-pricing/exchange-rate/refresh", json={}).status_code == 409
    assert Decimal(pricing.current_rate(db_session).krw_per_unit) == Decimal("1300")

    back = client.post("/api/admin/claude-pricing/exchange-rate/auto", json={"on": True})
    assert back.status_code == 200 and back.json()["fx"]["auto_enabled"] is True
    assert db_session.query(AuditLog).filter_by(action="exchange_rate.auto_set").count() == 1

    # 1300 → 1385 is +6.5%: held back, shown as the warning.
    refreshed = client.post("/api/admin/claude-pricing/exchange-rate/refresh", json={})
    assert refreshed.status_code == 200, refreshed.text
    body = refreshed.json()
    assert body["fx"]["outcome"] == "blocked" and "6.5%" in body["fx"]["note"]
    assert body["exchange_rate"]["krw_per_usd"] == "1300.00"


def test_the_routes_are_admin_only(anon_client: TestClient, other_user, config) -> None:
    anon_client.post("/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD})
    assert anon_client.post("/api/admin/claude-pricing/exchange-rate/auto", json={"on": False}).status_code == 403
    assert anon_client.post("/api/admin/claude-pricing/exchange-rate/refresh", json={}).status_code == 403


def test_the_frankfurter_parser_and_its_refusals() -> None:
    class Response:
        def __init__(self, status_code: int, body: object) -> None:
            self.status_code = status_code
            self._body = body

        def json(self):
            return self._body

    calls: list[tuple] = []

    def get(url, params=None, timeout=None):
        calls.append((url, params, timeout))
        return Response(200, {"base": "USD", "date": "2026-10-16", "rates": {"KRW": 1385.126}})

    quote = fx.FrankfurterFxProvider(get=get).fetch()
    assert quote == fx.FxQuote(rate=Decimal("1385.13"), as_of=date(2026, 10, 16), source="frankfurter")
    assert calls[0][0] == fx.FRANKFURTER_URL and calls[0][1] == {"base": "USD", "symbols": "KRW"}

    with pytest.raises(fx.FxError):
        fx.FrankfurterFxProvider(get=lambda *a, **k: Response(503, {})).fetch()
    with pytest.raises(fx.FxError):
        fx.FrankfurterFxProvider(get=lambda *a, **k: Response(200, {"rates": {}})).fetch()
    with pytest.raises(fx.FxError):
        fx.FrankfurterFxProvider(get=lambda *a, **k: Response(200, {"date": "2026-10-16", "rates": {"KRW": 5}})).fetch()

    def boom(*a, **k):
        raise OSError("down")

    with pytest.raises(fx.FxError):
        fx.FrankfurterFxProvider(get=boom).fetch()


def test_the_provider_is_chosen_by_the_setting_and_is_keyless() -> None:
    assert isinstance(fx.get_fx_provider(Settings(app_env="development")), fx.MockFxProvider)
    assert isinstance(fx.get_fx_provider(Settings(app_env="development", fx_provider="frankfurter")), fx.FrankfurterFxProvider)
    settings = Settings(app_env="development", fx_provider="frankfurter")
    assert settings.provider_mode("fx") == "frankfurter" and settings.provider_has_key("fx") is True


def test_the_job_runs_and_a_dry_run_writes_nothing(db_session: Session, config, mock_rate, monkeypatch, capsys) -> None:
    from app.jobs import refresh_fx

    class Factory:
        def __call__(self):
            return self

        def __enter__(self):
            return db_session

        def __exit__(self, *args):
            return False

    monkeypatch.setattr("app.db.session.SessionLocal", Factory())
    monkeypatch.setattr("app.jobs.refresh_fx.get_settings", lambda: config)
    pricing.seed_defaults(db_session)
    db_session.commit()
    before = len(rates(db_session))

    assert refresh_fx.main(["--dry-run"]) == 0
    assert "applied" in capsys.readouterr().out
    assert len(rates(db_session)) == before
    assert refresh_fx.main([]) == 0
    assert len(rates(db_session)) == before + 1
