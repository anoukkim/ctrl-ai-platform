"""A member's own notifications (feat-notifications, owner-polish 2).

Every route is `get_current_user`: reading one's own list and marking it
read spend nothing and must work while not taking part this quarter.
Another member's row is a 404 — never a 403 that confirms it exists.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.notification import EmptyBody, NotificationList, NotificationRead, UnreadRead
from app.services import notifications

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationList, summary="My notifications, newest first")
def list_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> NotificationList:
    """Reading also tidies: rows older than 90 days go, and the daily
    spend summaries up to yesterday are written from the ledger."""
    notifications.prune(db, user.id)
    notifications.ensure_spend_summaries(db, user)
    db.commit()
    items = notifications.list_for(db, user)
    return NotificationList(
        items=[NotificationRead.model_validate(row) for row in items],
        unread=notifications.unread_count(db, user.id),
    )


@router.get("/unread", response_model=UnreadRead, summary="How many are unread (the bell)")
def unread(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> UnreadRead:
    return UnreadRead(unread=notifications.unread_count(db, user.id))


@router.post("/read-all", response_model=UnreadRead, summary="모두 읽음")
def read_all(
    payload: EmptyBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> UnreadRead:
    notifications.mark_all_read(db, user.id)
    db.commit()
    return UnreadRead(unread=0)


@router.post("/{notification_id}/read", response_model=NotificationRead, summary="Mark one read")
def read_one(
    notification_id: int,
    payload: EmptyBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationRead:
    row = notifications.own(db, user, notification_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="알림을 찾을 수 없습니다.")
    notifications.mark_read(db, row)
    db.commit()
    db.refresh(row)
    return NotificationRead.model_validate(row)
