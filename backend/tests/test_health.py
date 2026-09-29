"""Tests for the health endpoint and service banner."""

from fastapi.testclient import TestClient


def test_root_returns_service_banner(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["service"] == "ctrl-ai-backend"


def test_health_reports_ok_when_database_reachable(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "ctrl-ai-backend"
    assert payload["database"]["status"] == "ok"
    assert payload["version"]
    assert payload["environment"]


def test_health_reports_degraded_when_database_unreachable(
    client_without_database: TestClient,
) -> None:
    response = client_without_database.get("/api/health")

    # Still 200: the API itself is alive. Only the database is down.
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["database"]["status"] == "unavailable"


def test_health_does_not_leak_connection_details(
    client_without_database: TestClient,
) -> None:
    """The error detail must not contain credentials or host names."""
    detail = client_without_database.get("/api/health").json()["database"]["detail"]

    assert detail == "OperationalError"
    assert "ctrlai" not in (detail or "")
