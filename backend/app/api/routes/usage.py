"""The member's own usage.

One endpoint, because the Usage screen is one screen: it needs the
quarter, both community budgets, the personal wallet and the recent
ledger rows together. Fetching them separately is how the screen ends up
showing figures from four different moments.
"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import (
    BudgetCategory,
    BuilderProject,
    QuarterAllocation,
    User,
    VideoProject,
)
from app.schemas.usage import (
    CategoryUsage,
    MyUsage,
    PersonalUsage,
    UsageEventRead,
)
from app.services.quarters import current_quarter, membership_for
from app.services.usage import personal_balance, recent_events

router = APIRouter(prefix="/usage", tags=["usage"])

#: Who performs the work for each category. Shown on the card so the
#: member knows which service their money is paying for.
CATEGORY_PROVIDER = {
    BudgetCategory.BUILD: "Claude",
    BudgetCategory.VIDEO: "Higgsfield",
}


def _label_for(db: Session, event) -> str:
    """A name the member recognises for where a charge came from."""
    if event.builder_project_id is not None:
        project = db.get(BuilderProject, event.builder_project_id)
        if project is not None:
            return f"Project Builder — {project.name}"
    if event.video_project_id is not None:
        project = db.get(VideoProject, event.video_project_id)
        if project is not None:
            return f"영상 — {project.name}"
    return "Project Builder" if event.category is BudgetCategory.BUILD else "영상"


@router.get("/me", response_model=MyUsage, summary="My usage this quarter")
def read_my_usage(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MyUsage:
    quarter = current_quarter(db)
    balance = personal_balance(db, user.id)

    categories: list[CategoryUsage] = []
    total_budget = 0
    days_remaining = None
    membership_status = None

    if quarter is not None:
        days_remaining = max(0, (quarter.ends_at - date.today()).days)
        membership = membership_for(db, user.id, quarter.id)
        membership_status = membership.status.value if membership else None

        allocation = db.scalar(
            select(QuarterAllocation).where(
                QuarterAllocation.user_id == user.id,
                QuarterAllocation.quarter_id == quarter.id,
            )
        )
        if allocation is not None:
            total_budget = allocation.community_total_budget_krw
            categories = [
                CategoryUsage(
                    category=BudgetCategory.BUILD,
                    provider=CATEGORY_PROVIDER[BudgetCategory.BUILD],
                    budget_krw=allocation.build_budget_krw,
                    consumed_krw=allocation.build_consumed_krw,
                    remaining_krw=allocation.build_remaining_krw,
                ),
                CategoryUsage(
                    category=BudgetCategory.VIDEO,
                    provider=CATEGORY_PROVIDER[BudgetCategory.VIDEO],
                    budget_krw=allocation.video_budget_krw,
                    consumed_krw=allocation.video_consumed_krw,
                    remaining_krw=allocation.video_remaining_krw,
                ),
            ]

    events = [
        UsageEventRead(
            **UsageEventRead.model_validate(event).model_dump(exclude={"label"}),
            label=_label_for(db, event),
        )
        for event in recent_events(db, user.id)
    ]

    return MyUsage(
        quarter_code=quarter.code if quarter else None,
        quarter_name=quarter.display_name if quarter else None,
        days_remaining=days_remaining,
        membership_status=membership_status,
        categories=categories,
        total_budget_krw=total_budget,
        personal=PersonalUsage(
            balance_krw=balance.balance_krw,
            consumed_krw=balance.consumed_krw,
            remaining_krw=max(0, balance.balance_krw - balance.consumed_krw),
            overage_enabled=balance.overage_enabled,
        ),
        events=events,
    )
