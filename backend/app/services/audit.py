"""Writing audit rows.

One helper so every admin route records a change the same way, and so
adding a new admin action is a one-line call rather than a new shape of
row.

`record` deliberately does **not** commit. The audit row must join the
same transaction as the change it describes: if the change rolls back, the
log must not claim it happened, and if the change commits, the log must
not be missing.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def record(
    db: Session,
    *,
    actor: User | None,
    action: str,
    target_type: str,
    summary: str,
    target_id: int | None = None,
    target_label: str = "",
    detail: dict | None = None,
) -> AuditLog:
    """Append one audit row. Does not commit — the caller owns the transaction."""
    row = AuditLog(
        actor_user_id=actor.id if actor else None,
        actor_username=actor.username if actor else "",
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_label=target_label,
        summary=summary,
        detail=detail,
    )
    db.add(row)
    return row


def recent(db: Session, limit: int = 100) -> list[AuditLog]:
    """The most recent entries, newest first.

    Read-only: there is no update or delete anywhere in the application.
    """
    return list(
        db.scalars(
            select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)
        )
    )
