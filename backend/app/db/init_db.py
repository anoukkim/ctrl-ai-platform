"""Create the local database tables and a development user.

Phase 0 uses SQLAlchemy's `create_all` for convenience. It creates any
missing tables but cannot change existing ones, so Phase 1 replaces this
with Alembic migrations before the schema starts evolving.

Run from the `backend/` directory, with PostgreSQL running:

    python -m app.db.init_db
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import SessionLocal, engine

# Importing the models registers them on `Base.metadata`, which is what
# `create_all` reads. Without this import no tables would be created.
from app.models import User, UserRole

DEV_USER_EMAIL = "dev@ctrl.ai"


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)


def seed_dev_user(db: Session) -> User:
    """Insert the development user once; return it if it already exists."""
    existing = db.scalar(select(User).where(User.email == DEV_USER_EMAIL))
    if existing is not None:
        return existing

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


def main() -> None:
    settings = get_settings()
    if not settings.is_development:
        # This script exists purely for local convenience. Seeding an
        # admin account into a real environment must never be automatic.
        raise SystemExit(f"Refusing to run: APP_ENV is {settings.app_env!r}, not development.")

    create_tables()
    print("Tables created (or already present).")

    with SessionLocal() as db:
        user = seed_dev_user(db)
    print(f"Development user ready: {user.email} (role={user.role.value}, id={user.id})")


if __name__ == "__main__":
    main()
