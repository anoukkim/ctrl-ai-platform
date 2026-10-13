"""Set an administrator's password from the server shell, safely.

    python -m app.db.set_admin_password <username>

For the owner who has forgotten the admin password (MORNING-2026-10-14 §2,
overnight batch): the password is typed at a **hidden prompt** (getpass),
twice, and never appears in the command line, the shell history or any
log. It must pass the same strength rules as bootstrap
(`admin_password_problem`).

Deliberately narrow:

* **admin accounts only** — this is a recovery door, not a way around a
  member's own password (members recover through the admin in the app).
* every session of the account is ended, like any password change
  (member-password-login), so a stolen cookie dies with the old password;
* the account's failed sign-in attempts are cleared, lifting a lockout
  (the per-address rows of other usernames are left alone);
* an audit row records that the CLI changed the password — never the
  password itself.

Unlike `reset_dev`, this runs in every environment: it exists for the
deployed server. It changes exactly one row and touches nothing else.
"""

from __future__ import annotations

import sys
from getpass import getpass

from sqlalchemy import delete, select

from app.core.config import admin_password_problem
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import LoginAttempt, User, UserRole, UserSession
from app.services import audit


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0].startswith("-"):
        print("사용법: python -m app.db.set_admin_password <관리자 아이디>")
        return 2
    username = argv[0].strip()

    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            print(f"그런 계정이 없습니다: {username}")
            return 1
        if user.role is not UserRole.ADMIN:
            # A member's password is theirs; this tool must not become a
            # way to enter someone else's account from the shell.
            print(f"{username} 계정은 관리자가 아닙니다. 이 명령은 관리자 계정만 바꿉니다.")
            return 1

        password = getpass("새 비밀번호 (화면에 보이지 않습니다): ")
        problem = admin_password_problem(password)
        if problem:
            print(f"비밀번호가 {problem}. 다른 비밀번호로 다시 실행해 주세요.")
            return 1
        if getpass("한 번 더 입력해 주세요: ") != password:
            print("두 입력이 서로 다릅니다. 처음부터 다시 실행해 주세요.")
            return 1

        user.password_hash = hash_password(password)
        # The old password may be in someone else's hands — their open
        # sessions and the lockout they caused go with it.
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        db.execute(
            delete(LoginAttempt).where(LoginAttempt.username == username.lower())
        )
        audit.record(
            db,
            actor=None,
            action="account.password_set_cli",
            target_type="user",
            target_id=user.id,
            target_label=user.username,
            summary=f"{user.username}의 비밀번호를 서버 셸에서 설정",
        )
        db.commit()
    finally:
        db.close()

    print(f"{username}의 비밀번호를 바꿨습니다. 모든 기기에서 로그아웃되었고, 잠금도 풀렸습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
