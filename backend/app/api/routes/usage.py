"""The member's own usage.

One endpoint, because the Usage screen is one screen: it needs the
quarter, the 동아리 지원 wallet and what it went on, the personal balance
and the recent ledger rows together. Fetching them separately is how the screen ends up
showing figures from four different moments.
"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import (
    BuilderProject,
    Conversation,
    QuarterAllocation,
    User,
    VideoProject,
)
from app.models.usage import spending_group
from app.schemas.usage import (
    MyUsage,
    PersonalUsage,
    SpendingLine,
    UsageEventRead,
    WalletUsage,
)
from app.schemas.accounting import (
    ConversationMoneyRead,
    DayMoneyRead,
    MemberMoneyRead,
    SplitRead,
)
from app.services import accounting
from app.services.quarters import current_quarter, membership_for
from app.services.usage import personal_balance, recent_events, spending_breakdown

router = APIRouter(prefix="/usage", tags=["usage"])

#: The wallet card's breakdown, in the order it is shown.
SPENDING_LABEL = {"chat": "채팅", "build": "빌더", "video": "영상", "other": "기타"}


#: What a video charge was for, when the event says. The prompt helper is
#: named so a Claude charge in the video workspace reads as what it was.
_VIDEO_FEATURE_LABEL = {
    "video_generate": "영상 생성",
    "video_edit": "영상 수정",
    "video_extend": "이어서 만들기",
    "video_prompt": "프롬프트 도움",
}


def _label_for(db: Session, event) -> str:
    """A name the member recognises for where a charge came from."""
    if event.feature == "chat":
        # Named by the conversation while it exists. A deleted one leaves
        # the charge, so the label falls back to the screen's name.
        conversation = (
            db.get(Conversation, event.conversation_id) if event.conversation_id else None
        )
        return f"Chat — {conversation.title}" if conversation and conversation.title else "Chat"
    if event.builder_project_id is not None:
        project = db.get(BuilderProject, event.builder_project_id)
        if project is not None:
            return f"Project Builder — {project.name}"
    if event.video_project_id is not None:
        project = db.get(VideoProject, event.video_project_id)
        if project is not None:
            return f"{_VIDEO_FEATURE_LABEL.get(event.feature or '', '영상')} — {project.name}"
    if event.feature == "build":
        return "Project Builder"
    return "영상" if spending_group(event.feature) == "video" else "기타"


@router.get("/me", response_model=MyUsage, summary="My usage this quarter")
def read_my_usage(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> MyUsage:
    quarter = current_quarter(db)
    balance = personal_balance(db, user.id)

    wallet: WalletUsage | None = None
    breakdown: list[SpendingLine] = []
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
            wallet = WalletUsage(
                budget_krw=allocation.budget_krw,
                consumed_krw=allocation.consumed_krw,
                remaining_krw=allocation.remaining_krw,
            )
            spent = spending_breakdown(db, user.id, quarter.id)
            breakdown = [
                SpendingLine(group=group, label=label, consumed_krw=spent[group])
                for group, label in SPENDING_LABEL.items()
            ]

    prices = accounting.catalogue_prices(db)
    events = [
        UsageEventRead(
            **UsageEventRead.model_validate(event).model_dump(
                exclude={"label", "group", "split"}
            ),
            group=spending_group(event.feature),
            label=_label_for(db, event),
            split=SplitRead(**accounting.split_of(event, prices).as_dict()),
        )
        for event in recent_events(db, user.id)
    ]

    money: MemberMoneyRead | None = None
    if quarter is not None:
        totals = accounting.member_money(db, user.id, quarter.id)
        money = MemberMoneyRead(
            quarter=SplitRead(**totals.quarter.as_dict()),
            by_conversation=[
                ConversationMoneyRead(
                    conversation_id=total.conversation_id,
                    title=total.title,
                    last_at=total.last_at,
                    split=SplitRead(**total.split.as_dict()),
                )
                for total in totals.by_conversation[:50]
            ],
            by_day=[
                DayMoneyRead(day=total.day, split=SplitRead(**total.split.as_dict()))
                for total in totals.by_day[:31]
            ],
        )

    return MyUsage(
        quarter_code=quarter.code if quarter else None,
        quarter_name=quarter.display_name if quarter else None,
        days_remaining=days_remaining,
        membership_status=membership_status,
        wallet=wallet,
        breakdown=breakdown,
        # personal-topup-off: not shown to members while 개인 충전 is off.
        personal=PersonalUsage(
            balance_krw=balance.balance_krw,
            consumed_krw=balance.consumed_krw,
            remaining_krw=max(0, balance.balance_krw - balance.consumed_krw),
            overage_enabled=balance.overage_enabled,
        )
        if settings.top_ups_enabled
        else None,
        events=events,
        money=money,
    )
