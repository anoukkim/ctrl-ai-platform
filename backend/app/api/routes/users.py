"""Read-only user endpoints.

Phase 0 exposes only a list endpoint so the development user created by
`python -m app.db.init_db` is visible end to end. There is no
authentication yet, so nothing here may create or modify users.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserRead

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserRead], summary="List users")
def list_users(db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).order_by(User.id)))
