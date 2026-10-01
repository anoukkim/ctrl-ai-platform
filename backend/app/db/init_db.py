"""Seed the local database with development data.

The schema is owned by Alembic — this script no longer creates tables:

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
    PersonalBalance,
    Quarter,
    QuarterStatus,
    User,
    UserRole,
    VideoModel,
)

DEV_USER_EMAIL = "dev@ctrl.ai"

# Ctrl AI runs by calendar quarter. The application window opens before the
# quarter starts, because members apply for the quarter ahead.
SEED_QUARTERS = [
    {
        "code": "2026-Q1",
        "display_name": "2026 Q1",
        "starts_at": date(2026, 1, 1),
        "ends_at": date(2026, 3, 31),
        "application_opens_at": date(2025, 12, 15),
        "application_closes_at": date(2025, 12, 31),
        "status": QuarterStatus.CLOSED,
    },
    {
        "code": "2026-Q3",
        "display_name": "2026 Q3",
        "starts_at": date(2026, 7, 1),
        "ends_at": date(2026, 9, 30),
        "application_opens_at": date(2026, 6, 15),
        "application_closes_at": date(2026, 6, 30),
        "status": QuarterStatus.CLOSED,
    },
    {
        "code": "2026-Q4",
        "display_name": "2026 Q4",
        "starts_at": date(2026, 10, 1),
        "ends_at": date(2026, 12, 31),
        "application_opens_at": date(2026, 9, 15),
        "application_closes_at": date(2026, 9, 30),
        # Applications are open, so Profile has something to invite the
        # development user to do.
        "status": QuarterStatus.APPLICATION_OPEN,
    },
]

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


def seed_quarters(db: Session) -> int:
    """Insert missing quarters, leaving any an admin has edited alone."""
    settings = get_settings()
    created = 0

    for spec in SEED_QUARTERS:
        if db.scalar(select(Quarter).where(Quarter.code == spec["code"])) is not None:
            continue
        db.add(Quarter(**spec, subsidy_limit_krw=settings.quarterly_subsidy_limit_krw))
        created += 1

    if created:
        db.commit()
    return created


def seed_wallet(db: Session, user: User) -> PersonalBalance:
    """An empty wallet, with personal spending off until the member opts in."""
    balance = db.scalar(select(PersonalBalance).where(PersonalBalance.user_id == user.id))
    if balance is not None:
        return balance

    balance = PersonalBalance(user_id=user.id)
    db.add(balance)
    db.commit()
    db.refresh(balance)
    return balance


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
        tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                if engine.dialect.name == "postgresql"
                else "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    missing = {"users", "quarters", "video_models"} - tables
    if missing:
        raise SystemExit(
            f"Missing tables: {', '.join(sorted(missing))}. Run `alembic upgrade head` first."
        )

    with SessionLocal() as db:
        user = seed_dev_user(db)
        quarters = seed_quarters(db)
        seed_wallet(db, user)
        models = seed_video_models(db)

    print(f"Development user: {user.email} (role={user.role.value}, id={user.id})")
    print(f"Quarters:         {quarters} created")
    print(f"Video models:     {models} created")
    print(f"Subsidy limit:    {settings.quarterly_subsidy_limit_krw:,} KRW per member per quarter")


if __name__ == "__main__":
    main()
