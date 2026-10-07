"""Anonymise members whose 30-day grace period is over.

    python -m app.jobs.anonymise_withdrawn            # do it
    python -m app.jobs.anonymise_withdrawn --dry-run  # only say what it would do

Safe to run as often as you like: an account is anonymised once, and a
second run finds nothing to do. Once a day is plenty.

A withdrawal still waiting for a refund (환불 대기) is skipped and listed,
not anonymised. Personal money is real money; the account is not
finalised until an admin has recorded that it was returned.

Each member is committed on their own, so one failure does not undo the
others, and a run interrupted halfway leaves nothing half-done.
"""

import argparse
import sys
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import RefundStatus
from app.services import withdrawal as withdrawal_service


@dataclass
class RunResult:
    anonymised: list[int] = field(default_factory=list)
    #: User ids whose grace period is over but whose refund is not recorded.
    waiting_for_refund: list[int] = field(default_factory=list)


def run(db: Session, now: datetime | None = None, dry_run: bool = False) -> RunResult:
    result = RunResult()
    for row in withdrawal_service.due_for_anonymisation(db, now):
        if row.refund_status is RefundStatus.PENDING:
            result.waiting_for_refund.append(row.user_id)
            continue
        if dry_run:
            result.anonymised.append(row.user_id)
            continue
        try:
            withdrawal_service.anonymise(db, row, now)
            db.commit()
        except Exception:
            db.rollback()
            raise
        result.anonymised.append(row.user_id)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="change nothing; only report")
    args = parser.parse_args(argv)

    # Imported here so `run` can be tested without touching the
    # configured database.
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        result = run(db, dry_run=args.dry_run)

    verb = "would anonymise" if args.dry_run else "anonymised"
    print(f"{verb} {len(result.anonymised)} account(s): {result.anonymised}")
    if result.waiting_for_refund:
        print(
            f"waiting for a refund to be recorded: {len(result.waiting_for_refund)} "
            f"account(s): {result.waiting_for_refund}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
