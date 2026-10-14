"""The old name of `app.db.set_password` — kept so it keeps working.

    python -m app.db.set_admin_password <username>

Until 2026-10-14 this reset admin accounts only. The owner generalised
it to any account (members ask the operator when they forget theirs —
terms §3); everything it does is in `set_password`.
"""

from __future__ import annotations

import sys

from app.db import set_password


def main(argv: list[str]) -> int:
    return set_password.main(argv, command="set_admin_password")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
