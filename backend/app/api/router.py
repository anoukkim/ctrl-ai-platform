"""Aggregates every route module under a single `/api` router.

Adding a new feature area means writing one module in `routes/` and
registering it here, rather than touching `main.py`.
"""

from fastapi import APIRouter

from app.api.routes import health, users

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(users.router)
