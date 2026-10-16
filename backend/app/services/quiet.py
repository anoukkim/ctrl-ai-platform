"""Changing a row without moving its `updated_at` (ui-improvements).

`TimestampMixin.updated_at` has `onupdate=func.now()`, so every ORM flush
of a changed row bumps it. Right for a rename or a new file; wrong for a
pin or a thumbnail stamp — 마지막 수정순 and the card's "N분 전" must mean
the member's own edits, and opening a project in 미리보기 (which takes a
picture) is not one. A Core UPDATE that names `updated_at` keeps it: the
`onupdate` default applies only to a column the statement leaves out.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session


def quiet_update(db: Session, instance: Any, **values: Any) -> None:
    """Set `values` on `instance`'s row, `updated_at` untouched; the
    instance's attributes are expired so the next read sees the row."""
    model = type(instance)
    db.flush()
    db.execute(
        update(model).where(model.id == instance.id).values(updated_at=model.updated_at, **values)
    )
    db.expire(instance, list(values))
