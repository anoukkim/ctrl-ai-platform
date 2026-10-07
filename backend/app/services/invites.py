"""Invite codes: normalising, generating, and taking one use safely.

The one rule that matters is in `claim`: a use is taken by a single
conditional `UPDATE ... SET uses = uses + 1 WHERE <still usable>`, and the
caller looks at how many rows it changed. Two people pressing 가입 at the
same moment on the last use of a code both run that statement; the
database applies them one after the other, the second finds the condition
false, and only one account is created. Reading `uses` first and writing
it back later — the obvious way — lets both through.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.models import InviteCode

#: Readable: no 0/O, 1/I/L, so a code read aloud or copied by hand works.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

#: What a custom code may contain once normalised.
CODE_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9-]{3,39}$")

#: The two messages a member can see. Deliberately the same for a code
#: that does not exist and one that is expired, used up or switched off,
#: so the form cannot be used to learn which codes exist.
CODE_REQUIRED = "초대 코드가 필요합니다."
CODE_UNUSABLE = "사용할 수 없는 초대 코드입니다."


def normalise(raw: str | None) -> str:
    """Trimmed and upper case — codes are case-insensitive."""
    return (raw or "").strip().upper()


def generate(db: Session) -> str:
    """A fresh readable code such as `CTRL-7KQ4-M2XP`, not already taken."""
    while True:
        body = "".join(secrets.choice(_ALPHABET) for _ in range(8))
        code = f"CTRL-{body[:4]}-{body[4:]}"
        if db.scalar(select(InviteCode.id).where(InviteCode.code == code)) is None:
            return code


def _usable(now: datetime):
    return (
        InviteCode.is_active.is_(True),
        InviteCode.uses < InviteCode.max_uses,
        or_(InviteCode.expires_at.is_(None), InviteCode.expires_at > now),
    )


def find_usable(db: Session, code: str) -> InviteCode | None:
    """The code if it could be used right now. A read; it takes nothing."""
    if not code:
        return None
    now = datetime.now(timezone.utc)
    return db.scalar(select(InviteCode).where(InviteCode.code == code, *_usable(now)))


def claim(db: Session, invite_id: int) -> bool:
    """Take one use, atomically. Does not commit — the caller's transaction
    creates the account in the same commit, so a use is never taken for an
    account that was not created."""
    now = datetime.now(timezone.utc)
    result = db.execute(
        update(InviteCode)
        .where(InviteCode.id == invite_id, *_usable(now))
        .values(uses=InviteCode.uses + 1)
        .execution_options(synchronize_session="fetch")
    )
    return result.rowcount == 1
