"""Aggregates every route module under a single `/api` router.

Adding a new feature area means writing one module in `routes/` and
registering it here, rather than touching `main.py`.
"""

from fastapi import APIRouter

from app.api.routes import (
    account,
    admin,
    admin_overview,
    admin_quarters,
    admin_withdrawals,
    admin_work,
    auth,
    builder,
    health,
    quarters,
    usage,
    users,
    video,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(account.router)
api_router.include_router(users.router)
api_router.include_router(builder.router)
api_router.include_router(video.router)
api_router.include_router(quarters.router)
api_router.include_router(usage.router)
api_router.include_router(admin.router)
api_router.include_router(admin_quarters.router)
api_router.include_router(admin_overview.router)
api_router.include_router(admin_work.router)
api_router.include_router(admin_withdrawals.router)
