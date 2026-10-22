"""The member's own usage.

One endpoint, because the Usage screen is one screen: it needs the
quarter, the 동아리 지원 wallet and what it went on, the personal balance
and the recent ledger rows together. Fetching them separately is how the screen ends up
showing figures from four different moments.
"""

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
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
from app.services import accounting, milestones
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
    if event.feature == "image_generate":
        conversation = (
            db.get(Conversation, event.conversation_id) if event.conversation_id else None
        )
        return f"이미지 — {conversation.title}" if conversation and conversation.title else "이미지"
    if event.feature in ("app_ai", "app_ai_preview"):
        # app-platform P2: AI inside a member app, paid by the visitor; P4:
        # the maker trying it in the Builder's 미리보기.
        project = db.get(BuilderProject, event.builder_project_id) if event.builder_project_id else None
        head = "앱 미리보기" if event.feature == "app_ai_preview" else "앱"
        if project is not None:
            return f"{head} · {project.name}"
        return f"{head} · {event.work_label} (삭제됨)" if event.work_label else head
    if event.builder_project_id is not None:
        project = db.get(BuilderProject, event.builder_project_id)
        if project is not None:
            return f"Project Builder — {project.name}"
    if event.video_project_id is not None:
        project = db.get(VideoProject, event.video_project_id)
        if project is not None:
            return f"{_VIDEO_FEATURE_LABEL.get(event.feature or '', '영상')} — {project.name}"
    # The project was purged for good (ui-improvements B): its name was
    # copied onto the row first, so the charge still says what it was for.
    if event.work_label:
        head = (
            _VIDEO_FEATURE_LABEL.get(event.feature or "", "영상")
            if spending_group(event.feature) == "video"
            else "Project Builder"
        )
        return f"{head} — {event.work_label} (삭제됨)"
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



# ------------------------------------------- milestones (spend feedback)


class MilestoneRequest(BaseModel):
    """Empty on purpose. A JSON body is still required, as on every
    state-changing route: a page on another origin cannot send one without
    a CORS preflight the API refuses (CLAUDE.md §2)."""


class MilestoneClaim(BaseModel):
    #: The highest milestone newly reached by this claim, or None.
    #: "first" | "used_25" | "used_50" | "used_75" | "low" | "empty".
    milestone: str | None
    budget_krw: int
    consumed_krw: int
    remaining_krw: int
    percent_used: int


@router.post(
    "/me/milestones",
    response_model=MilestoneClaim | None,
    summary="Record and return the newest spend milestone",
)
def claim_milestone(
    _payload: MilestoneRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MilestoneClaim | None:
    """Called by the screen after a charge (feat-spend-feedback).

    Reads the wallet as `usage.charge()` left it — never a figure from the
    browser — records every milestone newly crossed, and returns the
    highest one, so each shows once per quarter on any device. Spends
    nothing. None without a current quarter or wallet.
    """
    claim = milestones.claim(db, user)
    if claim is None:
        return None
    return MilestoneClaim(
        milestone=claim.milestone,
        budget_krw=claim.budget_krw,
        consumed_krw=claim.consumed_krw,
        remaining_krw=claim.remaining_krw,
        percent_used=claim.percent_used,
    )
