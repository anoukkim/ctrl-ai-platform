"""Record a finished backup, for Admin › System (admin-consolidation v3 (4)).

    python -m app.db.record_backup <local|offsite> <file name> <bytes>

Called by `deploy/backup.sh` and `deploy/offsite-backup.sh` after a
backup succeeds (inside the backend container, through `docker compose
exec`). It writes one `backup_runs` row and nothing else; a failure here
never fails the backup itself — the scripts ignore it.
"""

from __future__ import annotations

import sys

from app.db.session import SessionLocal
from app.services import backups

USAGE = "사용법: python -m app.db.record_backup <local|offsite> <파일 이름> <바이트>"


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(USAGE)
        return 2
    kind, file_name, raw_size = argv
    try:
        size = int(raw_size)
        db = SessionLocal()
        try:
            backups.record(db, kind, file_name, size)
            db.commit()
        finally:
            db.close()
    except ValueError as error:
        print(f"기록하지 않았습니다: {error}")
        return 1
    print(f"백업을 기록했습니다: {kind} {file_name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
