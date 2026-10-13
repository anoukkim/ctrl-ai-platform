"""Personal balance helpers.

One place creates a wallet, because a column default is applied at INSERT
rather than at construction: a freshly built `PersonalBalance` has
`balance_krw = None` until it is flushed, and adding to it raises. Both
the member route and the admin confirmation route need a wallet, so the
creation lives here rather than being written twice.
"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import PersonalBalance


def get_or_create_balance(db: Session, user_id: int) -> PersonalBalance:
    """Return the member's wallet, creating an empty one on first use.

    The new row is flushed before it is returned, so its numeric columns
    hold 0 rather than None and the caller can add to them safely.
    """
    balance = db.scalar(select(PersonalBalance).where(PersonalBalance.user_id == user_id))
    if balance is not None:
        return balance

    # A new member's first screen asks for the wallet from two requests at
    # once (the sidebar and Usage). Both find nothing and both insert; the
    # second hits the unique user_id. Inside a savepoint that loser rolls
    # back only its own insert and reads the winner's row.
    balance = PersonalBalance(user_id=user_id, balance_krw=0, consumed_krw=0)
    try:
        with db.begin_nested():
            db.add(balance)
            db.flush()
    except IntegrityError:
        existing = db.scalar(select(PersonalBalance).where(PersonalBalance.user_id == user_id))
        if existing is None:
            raise
        return existing
    return balance
