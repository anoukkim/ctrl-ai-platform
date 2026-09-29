"""Health endpoint.

`GET /api/health` always answers with HTTP 200 as long as the API process
itself is alive, and reports the database separately. That distinction is
useful while developing: it tells you whether the backend is down or only
PostgreSQL is down.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.health import DatabaseHealth, HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

SERVICE_NAME = "ctrl-ai-backend"
SERVICE_VERSION = "0.1.0"


def check_database(db: Session) -> DatabaseHealth:
    """Run the cheapest possible query to prove the connection works."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        # Log the full error server-side, but return only a short message,
        # because the driver's text can contain host and credential details.
        logger.warning("Database health check failed: %s", exc)
        return DatabaseHealth(status="unavailable", detail=type(exc).__name__)
    return DatabaseHealth(status="ok")


@router.get("/health", response_model=HealthResponse, summary="Backend and database health")
def health(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    database = check_database(db)
    return HealthResponse(
        status="ok" if database.status == "ok" else "degraded",
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        environment=settings.app_env,
        database=database,
    )
