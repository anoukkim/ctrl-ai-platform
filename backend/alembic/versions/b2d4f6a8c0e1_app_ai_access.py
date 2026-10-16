"""app-ai-access — how an app's AI is opened to other members

`builder_projects.ai_access`: "demo" (visitors' `ctrlai.ai` calls are
refused, 0원; the app shows its demo answers) or "full" (signed-in visitors
pay from their own 지원금). Apps published before this keep working as
they did — they are set to "full"; everything else starts as "demo", the
safest default for a newly published app.

`builder_project_versions.uses_ai`: the version's pages and scripts call
`ctrlai.ai` (found when the version is written; filled in here for the
versions that already exist), so the 게시 dialog, the listing and the
shell read a flag instead of the files.

Revision ID: b2d4f6a8c0e1
Revises: a3c7e9b1d5f2
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2d4f6a8c0e1"
down_revision: str | None = "a3c7e9b1d5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "builder_projects",
        sa.Column("ai_access", sa.String(length=8), nullable=False, server_default="demo"),
    )
    op.add_column(
        "builder_project_versions",
        sa.Column("uses_ai", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # Published apps keep today's behaviour: their AI stays open to visitors.
    op.execute("UPDATE builder_projects SET ai_access = 'full' WHERE published_version_id IS NOT NULL")

    # The flag for versions that already exist — the same search the code
    # runs when a version is written (app_ai_access.uses_ai).
    from app.services.app_ai_access import uses_ai

    bind = op.get_bind()
    versions = sa.table(
        "builder_project_versions", sa.column("id", sa.Integer), sa.column("files", sa.JSON), sa.column("uses_ai", sa.Boolean)
    )
    for row in bind.execute(sa.select(versions.c.id, versions.c.files)).all():
        files = row.files if isinstance(row.files, list) else []
        if uses_ai(files):
            bind.execute(sa.update(versions).where(versions.c.id == row.id).values(uses_ai=True))


def downgrade() -> None:
    op.drop_column("builder_project_versions", "uses_ai")
    op.drop_column("builder_projects", "ai_access")
