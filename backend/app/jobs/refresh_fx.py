"""Refresh the USD→KRW rate from the configured source (owner-polish-3 (b)).

    python -m app.jobs.refresh_fx [--dry-run]

Run once a day by `deploy/daily-jobs.sh`. Idempotent: the same quote twice
changes nothing. A failed fetch keeps the last rate and exits 0 — the
outcome is in the log and in Admin › System; a charge is never blocked.
"""

from __future__ import annotations

import argparse
import sys

from app.core.config import get_settings
from app.services import fx


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="fetch and report; write nothing")
    args = parser.parse_args(argv)

    from app.db.session import SessionLocal

    settings = get_settings()
    with SessionLocal() as db:
        result = fx.refresh(db, settings)
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
    print(f"{result.outcome}: {result.message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
