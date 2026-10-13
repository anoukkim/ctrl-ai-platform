"""Prepare a fresh deployed database: the administrator, and nothing else.

Run once on the server, after the migrations:

    alembic upgrade head
    python -m app.db.bootstrap

The Launch data rules (prep-beta-launch) say the production database
starts empty. So this creates exactly two things:

* **the administrator** from ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD;
* **the video model catalogue** — the list Admin › Video Models edits,
  the same kind of reference data the migrations already write for the
  Claude model catalogue. Without it Video Generator has no model to
  offer. It is not sample work: no member, project, video, usage or audit
  row is written.

It runs in any environment, is safe to run twice (an existing account is
left as it is, password included), and refuses a known default or short
password. It also refuses a database that already holds the development
account, because that means a local database was copied to the server —
which the deployment guide forbids.
"""

import sys

from sqlalchemy import select

from app.core.config import admin_password_problem, get_settings
from app.db.init_db import DEV_USER_EMAIL, seed_admin, seed_video_models, seed_wallet
from app.db.session import SessionLocal, engine
from app.models import User


def _tables() -> set[str]:
    with engine.connect() as connection:
        return {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                if engine.dialect.name == "postgresql"
                else "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }


def main() -> int:
    settings = get_settings()

    missing = {"users", "video_models", "chat_models"} - _tables()
    if missing:
        print(
            f"테이블이 없습니다: {', '.join(sorted(missing))}. "
            "먼저 `alembic upgrade head`를 실행하세요."
        )
        return 1

    username = settings.admin_username.strip()
    email = settings.admin_email.strip()
    password = settings.admin_password
    if not (username and email and password):
        print(".env에 ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD를 모두 적어 주세요.")
        return 1

    problem = admin_password_problem(password)
    if problem:
        print(f"ADMIN_PASSWORD {problem}. .env에서 실제 비밀번호로 바꿔 주세요.")
        return 1

    with SessionLocal() as db:
        if not settings.is_development and db.scalar(
            select(User.id).where(User.email == DEV_USER_EMAIL)
        ):
            print(
                "이 데이터베이스에 개발용 계정(dev)이 있습니다. 로컬 데이터베이스를 "
                "복사해 온 것으로 보입니다. 서버의 데이터베이스는 비어 있는 상태에서 "
                "시작해야 합니다 — 아무것도 만들지 않고 멈춥니다."
            )
            return 1

        existed = db.scalar(
            select(User.id).where((User.username == username) | (User.email == email))
        )
        admin = seed_admin(db)
        assert admin is not None  # all three values were checked above
        seed_wallet(db, admin)
        models = seed_video_models(db)

    if existed:
        print(f"관리자 계정:  {admin.username} — 이미 있어서 그대로 두었습니다.")
    else:
        print(f"관리자 계정:  {admin.username} / {admin.email} — 만들었습니다.")
    print(f"영상 모델 목록: {models}개 추가")
    print(
        "이제 .env에서 ADMIN_PASSWORD 줄의 값을 지워도 됩니다. "
        "비밀번호는 데이터베이스에 해시로만 남습니다."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
