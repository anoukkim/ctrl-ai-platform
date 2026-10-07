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
from app.core.security import UNUSABLE_PASSWORD_HASH, hash_password
from app.services.quarters import current_quarter, set_membership
from app.db.session import SessionLocal, engine
from app.models import (
    AccountStatus,
    MembershipStatus,
    PersonalBalance,
    Quarter,
    QuarterStatus,
    User,
    UserRole,
    VideoModel,
)

DEV_USER_EMAIL = "dev@ctrl.ai"
DEV_USER_USERNAME = "dev"

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
#
# **The prices are placeholders** (`prices_are_examples: True`), agreed as
# such on 2026-10-07: nobody has confirmed Higgsfield's per-second rates
# yet. Admin › Video Models labels them 예시 until an admin saves the
# model. The migration `9c4e7a2b1d63` writes the same figures into rows
# that already existed.
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
            "resolutions": ["720p", "1080p"],
            "sound": True,
            "supports_edit": True,
            "supports_extend": True,
            "price_per_second_krw": {"720p": 700, "1080p": 1000},
            "defaults": {
                "duration_seconds": 5,
                "aspect_ratio": "9:16",
                "resolution": "720p",
                "sound": True,
            },
            "prices_are_examples": True,
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
            "resolutions": ["480p", "720p"],
            "sound": False,
            "supports_edit": False,
            "supports_extend": True,
            "price_per_second_krw": {"480p": 300, "720p": 500},
            "defaults": {
                "duration_seconds": 5,
                "aspect_ratio": "9:16",
                "resolution": "480p",
                "sound": False,
            },
            "prices_are_examples": True,
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
            "resolutions": ["720p"],
            "sound": False,
            "supports_edit": False,
            "supports_extend": False,
            "price_per_second_krw": {"720p": 400},
            "defaults": {
                "duration_seconds": 5,
                "aspect_ratio": "16:9",
                "resolution": "720p",
                "sound": False,
            },
            "prices_are_examples": True,
        },
    },
]


def seed_dev_user(db: Session, password: str = "devpassword") -> User:
    """The development account.

    Kept so the existing local database and the tests keep working. The
    password is a development convenience and only ever reaches a database
    seeded by this script, which refuses to run outside development.
    """
    user = db.scalar(select(User).where(User.email == DEV_USER_EMAIL))
    if user is not None:
        # The Phase 1a migration backfills pre-existing rows with the
        # unusable-password sentinel, which would lock this account out of
        # a database that predates sign-in. Give it the development
        # password back — but only if no real one has been set, so this
        # can never overwrite a password somebody chose.
        if user.password_hash == UNUSABLE_PASSWORD_HASH:
            user.password_hash = hash_password(password)
            db.commit()
            db.refresh(user)
        return user

    user = User(
        username=DEV_USER_USERNAME,
        email=DEV_USER_EMAIL,
        password_hash=hash_password(password),
        display_name="Ctrl AI Developer",
        role=UserRole.ADMIN,
        account_status=AccountStatus.ACTIVE,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def seed_admin(db: Session) -> User | None:
    """The administrator described by ADMIN_* in `.env`.

    Returns None when the variables are blank, which is the default: an
    admin account is never created from values baked into the code. An
    existing account with the same username or email is left untouched,
    so re-running the seed never resets a password.
    """
    settings = get_settings()
    username = settings.admin_username.strip()
    email = settings.admin_email.strip()
    password = settings.admin_password

    if not (username and email and password):
        return None

    existing = db.scalar(select(User).where((User.username == username) | (User.email == email)))
    if existing is not None:
        return existing

    admin = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        display_name=username,
        role=UserRole.ADMIN,
        account_status=AccountStatus.ACTIVE,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def seed_membership(db: Session, user: User) -> None:
    """Make the development user a participant in the current quarter.

    Without this the seeded admin has an approved budget but no
    membership row, so `require_active_member` would refuse every
    creation request — which looks like a bug rather than a rule.
    """
    quarter = current_quarter(db)
    if quarter is None:
        return
    set_membership(db, user.id, quarter.id, MembershipStatus.ACTIVE)
    db.commit()


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
        admin = seed_admin(db)
        quarters = seed_quarters(db)
        seed_membership(db, user)
        seed_wallet(db, user)
        if admin is not None:
            seed_wallet(db, admin)
        models = seed_video_models(db)

    print(f"Development user: {user.username} / {user.email} (role={user.role.value})")
    if admin is None:
        print("Administrator:    none (set ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD in .env)")
    else:
        print(f"Administrator:    {admin.username} / {admin.email}")
    print(f"Quarters:         {quarters} created")
    print(f"Video models:     {models} created")
    print(f"Subsidy limit:    {settings.quarterly_subsidy_limit_krw:,} KRW per member per quarter")


if __name__ == "__main__":
    main()
