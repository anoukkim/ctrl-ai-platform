"""Request and response shapes for withdrawing from CTRL+AI."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.models import AccountWithdrawal, PublishedWorkChoice, RefundStatus
from app.services.withdrawal import WithdrawalPreview, can_restore


class WithdrawalPreviewRead(BaseModel):
    """What withdrawing would do — the confirmation dialog lists it."""

    released_krw: int
    personal_remaining_krw: int
    pending_top_ups: int
    published_apps: int
    published_videos: int
    builder_projects: int
    video_projects: int
    grace_period_days: int
    refund_hold: bool
    quarters: list[str]

    @classmethod
    def of(cls, preview: WithdrawalPreview) -> "WithdrawalPreviewRead":
        return cls(**vars(preview))


class WithdrawRequest(BaseModel):
    """The member's own 회원 탈퇴. The password is checked again."""

    password: str = Field(min_length=1, max_length=200)
    published_work: PublishedWorkChoice = PublishedWorkChoice.KEEP


class AdminWithdrawRequest(BaseModel):
    published_work: PublishedWorkChoice = PublishedWorkChoice.KEEP


class RefundRecordRequest(BaseModel):
    #: A transfer reference or a note. Optional, like a top-up's.
    reference: str = Field(default="", max_length=200)


class WithdrawalRead(BaseModel):
    id: int
    withdrawn_at: datetime
    grace_ends_at: datetime
    self_initiated: bool
    published_work: PublishedWorkChoice
    released_krw: int
    refund_status: RefundStatus
    refund_amount_krw: int
    refund_recorded_at: datetime | None
    refund_reference: str
    restored_at: datetime | None
    anonymised_at: datetime | None
    #: Worked out on the server, so the 복구 button and the rule that
    #: refuses it cannot disagree about the date.
    can_restore: bool

    @classmethod
    def of(cls, row: AccountWithdrawal) -> "WithdrawalRead":
        return cls(
            id=row.id,
            withdrawn_at=row.withdrawn_at,
            grace_ends_at=row.grace_ends_at,
            self_initiated=row.initiated_by == row.user_id,
            published_work=row.published_work,
            released_krw=row.released_krw,
            refund_status=row.refund_status,
            refund_amount_krw=row.refund_amount_krw,
            refund_recorded_at=row.refund_recorded_at,
            refund_reference=row.refund_reference,
            restored_at=row.restored_at,
            anonymised_at=row.anonymised_at,
            can_restore=can_restore(row),
        )
