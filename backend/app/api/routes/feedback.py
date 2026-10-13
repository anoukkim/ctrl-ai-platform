"""Feedback: a member sends a short note, an admin reads the list.

Sending is open to every signed-in account, participating or not — an
inactive member who cannot create anything is exactly the person whose
complaint is worth reading. It spends nothing.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models import FEEDBACK_MAX_LENGTH, FEEDBACK_PER_HOUR, Feedback, User
from app.schemas.feedback import FeedbackAdminRead, FeedbackCreate, FeedbackRead

router = APIRouter(tags=["feedback"])

#: The most rows Admin › Feedback shows. The beta has about 40 members.
ADMIN_LIST_LIMIT = 500


@router.post(
    "/feedback",
    response_model=FeedbackRead,
    status_code=status.HTTP_201_CREATED,
    summary="Send feedback",
)
def send_feedback(
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Feedback:
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="내용을 적어 주세요.")
    if len(body) > FEEDBACK_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"{FEEDBACK_MAX_LENGTH:,}자 이내로 적어 주세요.",
        )

    # Counted from saved rows, like Chat's rate limit: nothing to keep in
    # memory, and it holds across API workers.
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = db.scalar(
        select(func.count(Feedback.id)).where(
            Feedback.user_id == user.id, Feedback.created_at >= since
        )
    )
    if (recent or 0) >= FEEDBACK_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail="의견을 너무 자주 보내셨어요. 잠시 후 다시 보내 주세요.",
        )

    row = Feedback(
        user_id=user.id,
        body=body,
        page=payload.page.strip()[:200],
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get(
    "/admin/feedback",
    response_model=list[FeedbackAdminRead],
    summary="Feedback members sent, newest first",
)
def list_feedback(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[FeedbackAdminRead]:
    rows = db.execute(
        select(Feedback, User)
        .outerjoin(User, User.id == Feedback.user_id)
        .order_by(Feedback.created_at.desc(), Feedback.id.desc())
        .limit(ADMIN_LIST_LIMIT)
    ).all()
    return [
        FeedbackAdminRead(
            id=feedback.id,
            body=feedback.body,
            page=feedback.page,
            created_at=feedback.created_at,
            user_id=feedback.user_id,
            username=author.username if author else None,
            display_name=author.display_name if author else None,
        )
        for feedback, author in rows
    ]
