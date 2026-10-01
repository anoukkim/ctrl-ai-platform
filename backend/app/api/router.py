"""Aggregates every route module under a single `/api` router.

Adding a new feature area means writing one module in `routes/` and
registering it here, rather than touching `main.py`.
"""

from fastapi import APIRouter

from app.api.routes import admin, admin_quarters, builder, health, quarters, users, video

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(users.router)
api_router.include_router(builder.router)
api_router.include_router(video.router)
api_router.include_router(quarters.router)
api_router.include_router(admin.router)
api_router.include_router(admin_quarters.router)
