"""Wipe the LOCAL development database and seed it again.

    python -m app.db.reset_dev          # asks you to type "reset"
    python -m app.db.reset_dev --yes    # no question

Drops every table (the whole `public` schema), runs the migrations from
the start, then runs the development seed (`app.db.init_db`). Generated
files in the local storage folder are deleted too, because nothing in the
new database points at them any more.

Refuses unless APP_ENV is development **and** DATABASE_URL points at this
machine (localhost / 127.0.0.1). Both checks, because either alone can be
wrong: a `.env` copied around, or a tunnel to a real database.
"""

import shutil
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import make_url, text

from app.core.config import BACKEND_DIR, get_settings
from app.services.storage import storage_root

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def refusal() -> str | None:
    """Why this must not run here, or None."""
    settings = get_settings()
    if settings.deployed:
        # DEPLOYED=true comes from the production compose. Even with
        # APP_ENV mis-set to development there, nothing may drop a
        # deployed database (fix-beta-blockers 5).
        return "this is a deployed server (DEPLOYED=true)."
    if not settings.is_development:
        return f"APP_ENV is {settings.app_env!r}, not development."
    url = make_url(settings.database_url)
    if url.get_backend_name() != "postgresql":
        return "DATABASE_URL is not PostgreSQL."
    if (url.host or "") not in LOCAL_HOSTS:
        return f"DATABASE_URL points at {url.host!r}, not this machine."
    return None


def main(argv: list[str]) -> int:
    reason = refusal()
    if reason:
        print(f"Refusing to run: {reason}")
        return 1

    settings = get_settings()
    url = make_url(settings.database_url)
    print(f"This deletes EVERYTHING in {url.database!r} on {url.host}:{url.port or 5432}.")
    if "--yes" not in argv:
        if input('Type "reset" to continue: ').strip() != "reset":
            print("Nothing changed.")
            return 1

    # Imported here so that `--help`-style mistakes and refusals never
    # open a connection.
    from app.db import init_db
    from app.db.session import engine

    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    print("Dropped every table.")

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    command.upgrade(config, "head")
    print("Migrations applied.")

    root = storage_root(settings)
    if settings.storage_backend == "local" and root.is_dir() and BACKEND_DIR in root.parents:
        for child in root.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
        print(f"Emptied {root}.")

    init_db.main()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
