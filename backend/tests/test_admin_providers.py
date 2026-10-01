"""External service status, and the one rule that matters most.

**No route may return an API key.** The Admin 시스템 panel exists to say
whether a provider works, and answering that never requires showing the
credential. The first test here walks the whole response looking for the
configured secret, so a field added later that leaks it fails this.

The other thing worth proving: in mock mode the check must not touch the
network. Tests run with the default configuration — mock everywhere — so
a check that called out would make the suite depend on an API key and on
somebody else's uptime.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import ProviderErrorKind, ProviderStatus

SECRET = "sk-ant-not-a-real-key-0123456789"


@pytest.fixture
def real_claude():
    """Configure Claude as a real connection with a key, for this test only."""

    def override() -> Settings:
        return Settings(claude_provider="anthropic", anthropic_api_key=SECRET)

    app.dependency_overrides[get_settings] = override
    yield
    del app.dependency_overrides[get_settings]


# ------------------------------------------------------- 권한


def test_providers_are_admin_only(other_client: TestClient) -> None:
    assert other_client.get("/api/admin/providers").status_code == 403


def test_the_check_is_admin_only(other_client: TestClient) -> None:
    assert other_client.post("/api/admin/providers/claude/check").status_code == 403


def test_the_check_needs_a_session(anon_client: TestClient) -> None:
    assert anon_client.post("/api/admin/providers/claude/check").status_code == 401


# ------------------------------------------------- 키는 절대 나가지 않는다


def test_the_provider_list_never_returns_a_key(client: TestClient, real_claude) -> None:
    """The whole response body is searched for the configured secret."""
    response = client.get("/api/admin/providers")
    assert response.status_code == 200

    body = response.text
    assert SECRET not in body
    # Not even a fragment that would narrow a guess.
    assert "sk-ant" not in body

    claude = next(row for row in response.json() if row["key"] == "claude")
    # What it *does* say is whether one is configured.
    assert claude["has_key"] is True
    assert claude["is_mock"] is False
    assert claude["mode"] == "anthropic"


def test_the_check_never_returns_a_key(client: TestClient, real_claude, monkeypatch) -> None:
    """Including on the failure path, where an error could echo the request."""
    import httpx2

    class Boom(Exception):
        pass

    def explode(*args, **kwargs):
        # An error carrying the key, which is exactly what must not escape.
        raise Boom(f"connection failed for x-api-key={SECRET}")

    monkeypatch.setattr(httpx2, "get", explode)

    response = client.post("/api/admin/providers/claude/check")
    assert response.status_code == 200
    assert SECRET not in response.text

    # And it is not written to the status row either.
    listed = client.get("/api/admin/providers")
    assert SECRET not in listed.text


def test_no_provider_field_is_named_like_a_credential(client: TestClient) -> None:
    """A field called `api_key` must never appear, whatever its value."""
    body = json.dumps(client.get("/api/admin/providers").json()).lower()
    for forbidden in ("api_key", "apikey", "secret", "token", "credential", "password"):
        assert forbidden not in body, forbidden


# ------------------------------------------------------- mock 모드


def test_mock_mode_is_reported_for_every_provider(client: TestClient) -> None:
    """The default configuration is mock everywhere (CLAUDE.md section 20)."""
    rows = client.get("/api/admin/providers").json()

    assert [row["key"] for row in rows] == ["claude", "video", "github", "youtube"]
    assert all(row["is_mock"] for row in rows)
    assert all(row["mode"] == "mock" for row in rows)
    # Which environment variable to change is part of the answer.
    assert {row["setting"] for row in rows} == {
        "CLAUDE_PROVIDER",
        "VIDEO_PROVIDER",
        "GITHUB_PROVIDER",
        "YOUTUBE_PROVIDER",
    }


def test_the_check_in_mock_mode_calls_nothing_external(
    client: TestClient, monkeypatch
) -> None:
    """The important half: mock mode must not reach the network at all."""
    import httpx2

    def forbidden(*args, **kwargs):
        raise AssertionError("mock mode must not make an outbound request")

    monkeypatch.setattr(httpx2, "get", forbidden)
    monkeypatch.setattr(httpx2, "post", forbidden)

    response = client.post("/api/admin/providers/claude/check")
    assert response.status_code == 200

    body = response.json()
    assert body["ok"] is True
    assert "mock" in body["message"]


def test_a_mock_check_is_recorded_as_a_success(
    client: TestClient, db_session: Session
) -> None:
    assert client.post("/api/admin/providers/video/check").json()["ok"] is True

    row = db_session.get(ProviderStatus, "video")
    assert row is not None
    assert row.last_success_at is not None
    assert "mock" in row.last_success_label


def test_an_unknown_provider_is_404(client: TestClient) -> None:
    assert client.post("/api/admin/providers/openai/check").status_code == 404


# ------------------------------------------------------- 실제 연결


def test_a_real_provider_with_no_key_fails_without_calling_out(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    import httpx2

    monkeypatch.setattr(
        httpx2, "get", lambda *a, **k: pytest.fail("must not call out with no key")
    )

    def override() -> Settings:
        return Settings(claude_provider="anthropic", anthropic_api_key="")

    app.dependency_overrides[get_settings] = override
    try:
        body = client.post("/api/admin/providers/claude/check").json()
        assert body["ok"] is False
        assert "API 키가 없습니다" in body["message"]

        row = db_session.get(ProviderStatus, "claude")
        assert row.last_error_kind == ProviderErrorKind.AUTH
    finally:
        del app.dependency_overrides[get_settings]


def test_a_rejected_key_is_explained_in_korean(
    client: TestClient, db_session: Session, real_claude, monkeypatch
) -> None:
    """401 from the provider becomes a sentence an admin can act on."""
    import httpx2

    class Response:
        status_code = 401

    monkeypatch.setattr(httpx2, "get", lambda *a, **k: Response())

    body = client.post("/api/admin/providers/claude/check").json()
    assert body["ok"] is False
    assert "API 키가 거부되었습니다" in body["message"]

    row = db_session.get(ProviderStatus, "claude")
    assert row.last_error_kind == ProviderErrorKind.AUTH
    # The status line only — never a body that might echo the request.
    assert row.last_error_detail == "HTTP 401"


def test_a_provider_without_a_real_adapter_says_so(
    client: TestClient, monkeypatch
) -> None:
    """Honest rather than a green light that means nothing.

    Higgsfield's real adapter is Phase 6. Until it exists, the check must
    not pretend to have tested anything.
    """

    def override() -> Settings:
        return Settings(video_provider="higgsfield", hf_credentials="whatever")

    app.dependency_overrides[get_settings] = override
    try:
        body = client.post("/api/admin/providers/video/check").json()
        assert body["ok"] is False
        assert "Phase 6" in body["message"]
    finally:
        del app.dependency_overrides[get_settings]


# ------------------------------------------- 대시보드 경고 카드


def test_the_dashboard_warns_only_about_real_providers(
    client: TestClient, db_session: Session
) -> None:
    """A mock provider never raises a warning, however its row looks.

    Otherwise a fresh install — mock everywhere, which is the default —
    would greet every admin with a red card.
    """
    from datetime import datetime, timezone

    db_session.add(
        ProviderStatus(
            provider="claude",
            last_error_at=datetime.now(timezone.utc),
            last_error_kind=ProviderErrorKind.AUTH,
            last_error_detail="HTTP 401",
        )
    )
    db_session.commit()

    assert client.get("/api/admin/dashboard").json()["failing_providers"] == []


def test_the_dashboard_warns_when_a_real_provider_is_failing(
    client: TestClient, db_session: Session, real_claude
) -> None:
    from datetime import datetime, timezone

    db_session.add(
        ProviderStatus(
            provider="claude",
            last_error_at=datetime.now(timezone.utc),
            last_error_kind=ProviderErrorKind.AUTH,
            last_error_detail="HTTP 401",
        )
    )
    db_session.commit()

    assert client.get("/api/admin/dashboard").json()["failing_providers"] == ["Claude"]


def test_a_later_success_clears_the_dashboard_warning(
    client: TestClient, db_session: Session, real_claude
) -> None:
    """The warning follows the most recent event, not "has ever failed"."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    db_session.add(
        ProviderStatus(
            provider="claude",
            last_error_at=now - timedelta(hours=1),
            last_error_kind=ProviderErrorKind.AUTH,
            last_success_at=now,
            last_success_label="연결 확인",
        )
    )
    db_session.commit()

    assert client.get("/api/admin/dashboard").json()["failing_providers"] == []
