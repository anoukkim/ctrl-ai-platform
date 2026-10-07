"""Schemas for work an admin acts on across both products.

"Work" is the one word that covers a Builder project and a Video project
together. Admin › Deleted Items lists them in one table because an admin
restoring something does not care which product it came from — they care
whose it was and when it went.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

#: Which product an item belongs to. The URL carries the same two words,
#: so one admin route serves both without a branch in the client.
WorkKind = Literal["builder", "video"]


class DeletedItemRead(BaseModel):
    """One deleted project or video, as Admin sees it.

    Not built with `from_attributes`: the two models have different
    columns, and the owner's username lives on a third table. The route
    assembles this explicitly, which keeps the shape identical for both
    kinds.
    """

    kind: WorkKind
    id: int
    name: str
    owner_user_id: int
    owner_username: str
    owner_display_name: str
    deleted_at: datetime
    created_at: datetime
    updated_at: datetime
