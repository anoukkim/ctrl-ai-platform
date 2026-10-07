"""drop the archived project status

Members see two statuses on a project — Draft and 게시됨 — and nothing
ever offered "archive": deleting is soft (Deleted Items gives work back),
so a separate archived state only hid projects in a way no screen could
undo. Decided 2026-10-07 in the final UI pass.

Existing archived rows become draft. The CHECK constraints the
non-native enums carry are rebuilt without the value; the downgrade puts
it back (no row will hold it).

Revision ID: 7c1d5e93a4b2
Revises: 5e9a3c71d2b8
Create Date: 2026-10-07

"""

from collections.abc import Sequence

from alembic import op

revision: str = "7c1d5e93a4b2"
down_revision: str | None = "5e9a3c71d2b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: table, constraint (the enum's name), the values that stay
_TABLES = [
    ("builder_projects", "builderprojectstatus", ["draft", "building", "ready", "published"]),
    ("video_projects", "videoprojectstatus", ["draft", "generating", "ready", "published"]),
]


def _check(values: list[str]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"status IN ({quoted})"


def upgrade() -> None:
    for table, constraint, values in _TABLES:
        op.execute(f"UPDATE {table} SET status = 'draft' WHERE status = 'archived'")
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(constraint, type_="check")
            batch.create_check_constraint(constraint, _check(values))


def downgrade() -> None:
    for table, constraint, values in _TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(constraint, type_="check")
            batch.create_check_constraint(constraint, _check([*values, "archived"]))
