"""video project status follows the final version

Decided 2026-10-07, after the developer's probe project showed "Draft"
on the card and in the workspace header with v8 chosen as 최종본.

The rule, also enforced by `VideoProject.apply_final_version_rule` on
every update: a Draft (or Generating) project with a final version is
**Ready**; a Ready project with no final version is **Draft**. Published
and Archived are left alone.

This migration applies the rule to the rows that already exist. Data
only — no schema change. The downgrade does nothing: the old code did
not care which of the two a project was, and guessing which rows were
Draft before would only be a guess.

Revision ID: 4b8e2d6f1a90
Revises: 9c4e7a2b1d63
Create Date: 2026-10-07

"""

from collections.abc import Sequence

from alembic import op

revision: str = "4b8e2d6f1a90"
down_revision: str | None = "9c4e7a2b1d63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE video_projects SET status = 'ready' "
        "WHERE final_version_id IS NOT NULL AND status IN ('draft', 'generating')"
    )
    op.execute(
        "UPDATE video_projects SET status = 'draft' "
        "WHERE final_version_id IS NULL AND status = 'ready'"
    )


def downgrade() -> None:
    pass
