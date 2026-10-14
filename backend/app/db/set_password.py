"""Reset any account's password from the server shell, safely.

    python -m app.db.set_password <username>

For the beta, "비밀번호를 잊으면 운영진에게 문의" (terms §3) is answered
here: the operator runs this on the server for the member who asked
(owner, 2026-10-14). It generalises `set_admin_password`, whose name
keeps working as an alias.

* The password is typed at a **hidden prompt** (getpass), twice, and
  never appears in the command line, the shell history or any log.
* At least 12 characters and not a known default — the same rule as
  the admin's password (`admin_password_problem`), messages in Korean.
* Every session of the account is ended (a stolen cookie dies with the
  old password) and its failed sign-ins are cleared, lifting a lockout.
* An audit row records that the server operator reset it — never the
  password. There is no signed-in admin in a shell, so the actor is
  "서버 운영자" and the OS user goes into the detail.
* A former member (탈퇴 회원) cannot sign in at all; their password is
  not reset.

It changes exactly one account and touches nothing else, in every
environment — it exists for the deployed server.
"""

from __future__ import annotations

import getpass as getpass_module
import sys
from getpass import getpass

from sqlalchemy import delete, select

from app.core.config import DEFAULT_ADMIN_PASSWORDS, MIN_ADMIN_PASSWORD_LENGTH
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import AccountStatus, LoginAttempt, User, UserSession
from app.services import audit

USAGE = "사용법: python -m app.db.set_password <아이디>"


def password_problem(password: str) -> str | None:
    """Why this password is refused, in Korean, or None."""
    if password.strip().lower() in DEFAULT_ADMIN_PASSWORDS:
        return "널리 알려진 기본값이라 쓸 수 없습니다"
    if len(password) < MIN_ADMIN_PASSWORD_LENGTH:
        return f"{MIN_ADMIN_PASSWORD_LENGTH}자보다 짧습니다"
    return None


def _operator() -> str:
    try:
        return getpass_module.getuser()
    except Exception:  # noqa: BLE001 — no login name in some containers
        return "unknown"


def main(argv: list[str], *, command: str = "set_password") -> int:
    if len(argv) != 1 or argv[0].startswith("-"):
        print(USAGE.replace("set_password", command))
        return 2
    username = argv[0].strip()

    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            print(f"그런 계정이 없습니다: {username}")
            return 1
        if user.account_status is AccountStatus.FORMER:
            print(f"{username}은(는) 탈퇴한 계정이라 로그인할 수 없습니다. 비밀번호를 바꾸지 않았습니다.")
            return 1

        password = getpass("새 비밀번호 (화면에 보이지 않습니다): ")
        problem = password_problem(password)
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
        db.execute(delete(LoginAttempt).where(LoginAttempt.username == username.lower()))
        audit.record(
            db,
            actor=None,
            action="account.password_set_cli",
            target_type="user",
            target_id=user.id,
            target_label=user.username,
            summary=f"서버 운영자가 셸에서 {user.username}의 비밀번호를 재설정",
            detail={"operator": "server-shell", "os_user": _operator(), "role": user.role.value},
        )
        db.commit()
    finally:
        db.close()

    print(f"{username}의 비밀번호를 바꿨습니다. 모든 기기에서 로그아웃되었고, 잠금도 풀렸습니다.")
    print("새 비밀번호는 본인에게 직접 전하고, 로그인한 뒤 Profile에서 바꾸게 해 주세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
