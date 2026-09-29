"""Response schemas for the health endpoint.

Pydantic schemas define the shape of the JSON that leaves the backend.
Keeping them separate from the database models means an internal column
can never leak into an API response by accident.
"""

from typing import Literal

from pydantic import BaseModel, Field


class DatabaseHealth(BaseModel):
    """Result of the database connectivity probe."""

    status: Literal["ok", "unavailable"]
    detail: str | None = Field(
        default=None,
        description="Short error description when the database is unavailable.",
    )


class HealthResponse(BaseModel):
    """Overall backend health.

    `status` is "ok" when the API and the database are both fine, and
    "degraded" when the API is running but the database is unreachable.
    """

    status: Literal["ok", "degraded"]
    service: str
    version: str
    environment: str
    database: DatabaseHealth
