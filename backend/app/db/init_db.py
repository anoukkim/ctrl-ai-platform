"""Seed the local database with development data.

From Phase 1 on, the schema is owned by Alembic — this script no longer
creates tables. Run the migrations first:

    alembic upgrade head
    python -m app.db.init_db

Everything here is idempotent: running it twice changes nothing.
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal, engine
from app.models import (
    CreditAllocation,
    MembershipStatus,
    Season,
    SeasonMembership,
    SeasonStatus,
    User,
    UserRole,
    VideoModel,
)

DEV_USER_EMAIL = "dev@ctrl.ai"

# A season is four months. These dates match the ones the frontend shows
# while its data is still mocked.
DEV_SEASON = {
    "name": "2026 Season 2",
    "starts_at": date(2026, 9, 1),
    "ends_at": date(2026, 12, 31),
    "status": SeasonStatus.ACTIVE,
}

# Seed catalogue only. Provider catalogues change, so this is a starting
# point an admin edits — never the permanent list, and never hard-coded
# into the frontend.
SEED_VIDEO_MODELS = [
    {
        "provider": "higgsfield",
        "model_id": "kling-3.0-pro",
        "display_name": "Kling 3.0 Pro",
        "description": "인물과 움직임 표현이 안정적입니다. 기본값으로 쓰기 좋습니다.",
        "enabled": True,
        "member_visible": True,
        "sort_order": 10,
        "capabilities": {
            "durations": [5, 10, 15],
            "aspect_ratios": ["9:16", "16:9", "1:1"],
            "sound": True,
            "generation_types": ["text_to_video", "image_to_video"],
        },
    },
    {
        "provider": "higgsfield",
        "model_id": "seedance-2.0",
        "display_name": "Seedance 2.0",
        "description": "짧은 숏폼에 적합하고 생성이 빠릅니다.",
        "enabled": True,
        "member_visible": True,
        "sort_order": 20,
        "capabilities": {
            "durations": [5, 10],
            "aspect_ratios": ["9:16"],
            "sound": False,
            "generation_types": ["text_to_video"],
        },
    },
    {
        "provider": "higgsfield",
        "model_id": "wan-3.0",
        "display_name": "Wan 3.0",
        "description": "실험 중인 모델입니다. 아직 회원에게 공개하지 않습니다.",
        "enabled": False,
        "member_visible": False,
        "sort_order": 30,
        "capabilities": {
            "durations": [5],
            "aspect_ratios": ["16:9"],
            "sound": False,
            "generation_types": ["text_to_video"],
        },
    },
]

# What one member may spend in a season. Units differ per provider on
# purpose and are never converted into a single invented currency.
SEED_ALLOCATIONS = [
    {
        "provider": "anthropic",
        "resource_type": "text",
        "unit": "tokens",
        "allocated_amount": 2_000_000,
        "consumed_amount": 650_000,
    },
    {
        "provider": "higgsfield",
        "resource_type": "video",
        "unit": "credits",
        "allocated_amount": 100,
        "consumed_amount": 35,
    },
]


def seed_dev_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == DEV_USER_EMAIL))
    if user is not None:
        return user

    user = User(
        email=DEV_USER_EMAIL,
        display_name="Ctrl AI Developer",
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def seed_season(db: Session) -> Season:
    season = db.scalar(select(Season).where(Season.name == DEV_SEASON["name"]))
    if season is not None:
        return season

    season = Season(**DEV_SEASON)
    db.add(season)
    db.commit()
    db.refresh(season)
    return season


def seed_membership(db: Session, user: User, season: Season) -> SeasonMembership:
    membership = db.scalar(
        select(SeasonMembership).where(
            SeasonMembership.user_id == user.id,
            SeasonMembership.season_id == season.id,
        )
    )
    if membership is not None:
        return membership

    membership = SeasonMembership(
        user_id=user.id, season_id=season.id, status=MembershipStatus.ACTIVE
    )
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def seed_allocations(db: Session, user: User, season: Season) -> int:
    created = 0
    for spec in SEED_ALLOCATIONS:
        existing = db.scalar(
            select(CreditAllocation).where(
                CreditAllocation.user_id == user.id,
                CreditAllocation.season_id == season.id,
                CreditAllocation.provider == spec["provider"],
                CreditAllocation.resource_type == spec["resource_type"],
            )
        )
        if existing is not None:
            continue
        db.add(CreditAllocation(user_id=user.id, season_id=season.id, **spec))
        created += 1

    if created:
        db.commit()
    return created


def seed_video_models(db: Session) -> int:
    """Insert missing catalogue rows.

    Existing rows are left alone: an admin may have changed the switches,
    and re-running the seed must not undo that.
    """
    created = 0
    for spec in SEED_VIDEO_MODELS:
        existing = db.scalar(
            select(VideoModel).where(
                VideoModel.provider == spec["provider"],
                VideoModel.model_id == spec["model_id"],
            )
        )
        if existing is not None:
            continue
        db.add(VideoModel(**spec))
        created += 1

    if created:
        db.commit()
    return created


def main() -> None:
    settings = get_settings()
    if not settings.is_development:
        # Seeding an admin account into a real environment must never be
        # automatic.
        raise SystemExit(f"Refusing to run: APP_ENV is {settings.app_env!r}, not development.")

    # Fail early with a useful message if the migrations have not run.
    with engine.connect() as connection:
        tables = {row[0] for row in connection.exec_driver_sql(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
            if engine.dialect.name == "postgresql"
            else "SELECT name FROM sqlite_master WHERE type = 'table'"
        )}
    missing = {"users", "seasons", "video_models"} - tables
    if missing:
        raise SystemExit(
            f"Missing tables: {', '.join(sorted(missing))}. Run `alembic upgrade head` first."
        )

    with SessionLocal() as db:
        user = seed_dev_user(db)
        season = seed_season(db)
        seed_membership(db, user, season)
        allocations = seed_allocations(db, user, season)
        models = seed_video_models(db)

    print(f"Development user: {user.email} (role={user.role.value}, id={user.id})")
    print(f"Season:           {season.name} ({season.status.value})")
    print(f"Allocations:      {allocations} created")
    print(f"Video models:     {models} created")


if __name__ == "__main__":
    main()
