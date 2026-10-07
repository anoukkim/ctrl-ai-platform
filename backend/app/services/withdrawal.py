"""Withdrawing from CTRL+AI, restoring, refunding and anonymising.

Every path that makes an account `former` comes through `withdraw` — the
member's own 회원 탈퇴 on Profile, an admin's withdrawal from the member
detail page, and Admin's older "탈퇴 처리" participation setting. One
function means one set of rules: the same money is released, the same
refund hold applies, and the same grace period starts.

None of these functions commit. Like `audit.record`, they leave the
transaction to the caller, so the change and the audit rows describing it
land together or not at all.

The rules, in the order `withdraw` applies them:

1. **Participation ends.** Every membership row in a quarter that is not
   closed becomes `former`; a live application in such a quarter is
   cancelled.
2. **동아리 지원 is released.** Whatever was left of each allocation in a
   quarter that is not closed stops being spendable. The allocation's
   budget is lowered to what was consumed, so the Usage history still
   adds up, and the released amount is written to the audit log. There
   is no club reserve to return it to yet; `budget-by-provider` adds one.
3. **Personal money is held, never discarded.** A remaining 개인 충전
   balance — or a top-up request an admin has not yet looked at, whose
   deposit may already have been made — marks the withdrawal 환불 대기.
   Anonymisation waits until an admin records the refund.
4. **Published work** stays up labelled 탈퇴 회원, or is taken down if the
   member chose that.
5. **Every session ends**, and the account becomes `former`.

`reversal` records what each step replaced, so `restore` within the grace
period puts back exactly that and nothing it did not take.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.security import UNUSABLE_PASSWORD_HASH
from app.models import (
    GRACE_PERIOD_DAYS,
    AccountStatus,
    AccountWithdrawal,
    ApplicationStatus,
    AuditAction,
    BuilderProject,
    BuilderProjectStatus,
    MembershipStatus,
    PersonalBalance,
    PersonalTopUp,
    PublishedWorkChoice,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    QuarterMembership,
    QuarterStatus,
    RefundStatus,
    TopUpStatus,
    User,
    UserRole,
    UserSession,
    VideoProject,
    VideoProjectStatus,
)
from app.services import audit

#: What an anonymised member is called everywhere their name used to be.
ANONYMISED_DISPLAY_NAME = "탈퇴 회원"

#: An application in one of these states still counts as the member's
#: application for the quarter, so withdrawing cancels it.
_LIVE_APPLICATION = (ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED)


class WithdrawalError(Exception):
    """A withdrawal action that cannot go ahead. The message is Korean."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; treat those as UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def anonymised_username(user_id: int) -> str:
    """Contains a hyphen, which registration does not allow, so no one can
    sign up under the name before the job gets to it."""
    return f"withdrawn-{user_id}"


# ------------------------------------------------------------ lookups


def open_withdrawal(db: Session, user_id: int) -> AccountWithdrawal | None:
    """The withdrawal currently in effect for a member, if any."""
    return db.scalar(
        select(AccountWithdrawal)
        .where(AccountWithdrawal.user_id == user_id, AccountWithdrawal.restored_at.is_(None))
        .order_by(AccountWithdrawal.id.desc())
    )


def latest_withdrawal(db: Session, user_id: int) -> AccountWithdrawal | None:
    """The most recent withdrawal, restored or not — what Admin shows."""
    return db.scalar(
        select(AccountWithdrawal)
        .where(AccountWithdrawal.user_id == user_id)
        .order_by(AccountWithdrawal.id.desc())
    )


def can_restore(row: AccountWithdrawal, now: datetime | None = None) -> bool:
    now = now or utcnow()
    return row.is_open and row.anonymised_at is None and now < _aware(row.grace_ends_at)


def _unclosed_quarter_ids(db: Session) -> list[int]:
    return list(db.scalars(select(Quarter.id).where(Quarter.status != QuarterStatus.CLOSED)))


def _pending_top_ups(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.count(PersonalTopUp.id)).where(
            PersonalTopUp.user_id == user_id,
            PersonalTopUp.status == TopUpStatus.REQUESTED,
        )
    ) or 0


def _published(db: Session, user_id: int) -> tuple[list[BuilderProject], list[VideoProject]]:
    apps = list(
        db.scalars(
            select(BuilderProject).where(
                BuilderProject.owner_user_id == user_id,
                BuilderProject.status == BuilderProjectStatus.PUBLISHED,
                BuilderProject.deleted_at.is_(None),
            )
        )
    )
    videos = list(
        db.scalars(
            select(VideoProject).where(
                VideoProject.owner_user_id == user_id,
                VideoProject.status == VideoProjectStatus.PUBLISHED,
                VideoProject.deleted_at.is_(None),
            )
        )
    )
    return apps, videos


# ------------------------------------------------------------ preview


@dataclass
class WithdrawalPreview:
    """What withdrawing would do, for the confirmation dialog."""

    released_krw: int = 0
    personal_remaining_krw: int = 0
    pending_top_ups: int = 0
    published_apps: int = 0
    published_videos: int = 0
    builder_projects: int = 0
    video_projects: int = 0
    grace_period_days: int = GRACE_PERIOD_DAYS
    refund_hold: bool = False
    quarters: list[str] = field(default_factory=list)


def preview(db: Session, member: User) -> WithdrawalPreview:
    quarter_ids = _unclosed_quarter_ids(db)
    released = 0
    quarter_names: list[str] = []
    if quarter_ids:
        for allocation, quarter in db.execute(
            select(QuarterAllocation, Quarter)
            .join(Quarter, Quarter.id == QuarterAllocation.quarter_id)
            .where(
                QuarterAllocation.user_id == member.id,
                QuarterAllocation.quarter_id.in_(quarter_ids),
            )
        ):
            remaining = _remaining(allocation)
            if remaining:
                released += remaining
                quarter_names.append(quarter.display_name)

    balance = db.scalar(select(PersonalBalance).where(PersonalBalance.user_id == member.id))
    personal = balance.remaining_krw if balance else 0
    pending = _pending_top_ups(db, member.id)
    apps, videos = _published(db, member.id)

    return WithdrawalPreview(
        released_krw=released,
        personal_remaining_krw=personal,
        pending_top_ups=pending,
        published_apps=len(apps),
        published_videos=len(videos),
        builder_projects=db.scalar(
            select(func.count(BuilderProject.id)).where(
                BuilderProject.owner_user_id == member.id, BuilderProject.deleted_at.is_(None)
            )
        )
        or 0,
        video_projects=db.scalar(
            select(func.count(VideoProject.id)).where(
                VideoProject.owner_user_id == member.id, VideoProject.deleted_at.is_(None)
            )
        )
        or 0,
        refund_hold=personal > 0 or pending > 0,
        quarters=quarter_names,
    )


def _remaining(allocation: QuarterAllocation) -> int:
    return max(0, allocation.build_budget_krw - allocation.build_consumed_krw) + max(
        0, allocation.video_budget_krw - allocation.video_consumed_krw
    )


# ------------------------------------------------------------ withdraw


def withdraw(
    db: Session,
    *,
    member: User,
    actor: User,
    published_work: PublishedWorkChoice = PublishedWorkChoice.KEEP,
    now: datetime | None = None,
) -> AccountWithdrawal:
    """Make `member` a former member. Does not commit."""
    now = now or utcnow()

    if open_withdrawal(db, member.id) is not None:
        raise WithdrawalError("이미 탈퇴한 계정입니다.", status_code=409)

    if member.role is UserRole.ADMIN and _is_last_admin(db, member):
        # Otherwise nobody is left who could restore anyone, this account
        # included.
        raise WithdrawalError(
            "마지막 관리자는 탈퇴할 수 없습니다. 다른 관리자를 먼저 지정해 주세요.",
            status_code=409,
        )

    reversal: dict = {
        "memberships": [],
        "allocations": [],
        "applications": [],
        "unpublished": [],
        "overage_enabled": False,
    }
    quarter_ids = _unclosed_quarter_ids(db)

    # 1. Participation ends.
    if quarter_ids:
        for membership in db.scalars(
            select(QuarterMembership).where(
                QuarterMembership.user_id == member.id,
                QuarterMembership.quarter_id.in_(quarter_ids),
            )
        ):
            if membership.status is not MembershipStatus.FORMER:
                reversal["memberships"].append(
                    {"id": membership.id, "status": membership.status.value}
                )
                membership.status = MembershipStatus.FORMER

        for application in db.scalars(
            select(QuarterApplication).where(
                QuarterApplication.user_id == member.id,
                QuarterApplication.quarter_id.in_(quarter_ids),
                QuarterApplication.status.in_(_LIVE_APPLICATION),
            )
        ):
            reversal["applications"].append(
                {"id": application.id, "status": application.status.value}
            )
            application.status = ApplicationStatus.CANCELLED

    # 2. 동아리 지원 is released. Locked like `usage.charge` locks it, so a
    #    charge in flight cannot spend money that is being released.
    released_total = 0
    released_rows: list[tuple[QuarterAllocation, int, int]] = []
    if quarter_ids:
        for allocation in db.scalars(
            select(QuarterAllocation)
            .where(
                QuarterAllocation.user_id == member.id,
                QuarterAllocation.quarter_id.in_(quarter_ids),
            )
            .with_for_update()
        ):
            build = max(0, allocation.build_budget_krw - allocation.build_consumed_krw)
            video = max(0, allocation.video_budget_krw - allocation.video_consumed_krw)
            if not (build or video):
                continue
            allocation.build_budget_krw -= build
            allocation.video_budget_krw -= video
            allocation.community_total_budget_krw = (
                allocation.build_budget_krw + allocation.video_budget_krw
            )
            # The percentages are left alone on purpose: they record the
            # split that was approved, which the release does not change.
            reversal["allocations"].append({"id": allocation.id, "build": build, "video": video})
            released_rows.append((allocation, build, video))
            released_total += build + video

    # 3. Personal money is held.
    balance = db.scalar(
        select(PersonalBalance).where(PersonalBalance.user_id == member.id).with_for_update()
    )
    personal = balance.remaining_krw if balance else 0
    if balance is not None:
        reversal["overage_enabled"] = balance.overage_enabled
        balance.overage_enabled = False
    hold = personal > 0 or _pending_top_ups(db, member.id) > 0

    # 4. Published work.
    if published_work is PublishedWorkChoice.UNPUBLISH:
        apps, videos = _published(db, member.id)
        for app in apps:
            app.status = BuilderProjectStatus.READY
            reversal["unpublished"].append({"kind": "builder", "id": app.id})
        for video in videos:
            video.status = VideoProjectStatus.READY
            reversal["unpublished"].append({"kind": "video", "id": video.id})

    # 5. Sessions end and the account closes.
    db.execute(delete(UserSession).where(UserSession.user_id == member.id))
    member.account_status = AccountStatus.FORMER

    row = AccountWithdrawal(
        user_id=member.id,
        withdrawn_at=now,
        grace_ends_at=now + timedelta(days=GRACE_PERIOD_DAYS),
        initiated_by=actor.id,
        published_work=published_work,
        released_krw=released_total,
        refund_status=RefundStatus.PENDING if hold else RefundStatus.NONE,
        refund_amount_krw=personal,
        reversal=reversal,
    )
    db.add(row)
    db.flush()

    by_self = actor.id == member.id
    audit.record(
        db,
        actor=actor,
        action=AuditAction.ACCOUNT_WITHDRAWN,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=(
            f"{member.display_name}이(가) 탈퇴했습니다."
            if by_self
            else f"{member.display_name}을(를) 탈퇴 처리했습니다."
        )
        + (" 개인 충전 잔액이 있어 환불 대기입니다." if hold else ""),
        detail={
            "withdrawal_id": row.id,
            "self": by_self,
            "published_work": published_work.value,
            "released_krw": released_total,
            "personal_remaining_krw": personal,
            "refund_status": row.refund_status.value,
            "unpublished": len(reversal["unpublished"]),
        },
    )
    for allocation, build, video in released_rows:
        audit.record(
            db,
            actor=actor,
            action=AuditAction.ALLOCATION_RELEASED,
            target_type="allocation",
            target_id=allocation.id,
            target_label=member.username,
            summary=(
                f"탈퇴로 {member.display_name}의 남은 동아리 지원 "
                f"{build + video:,}원(Build {build:,}원 / Video {video:,}원)을 해제했습니다."
            ),
            detail={
                "withdrawal_id": row.id,
                "quarter_id": allocation.quarter_id,
                "build_released_krw": build,
                "video_released_krw": video,
            },
        )

    return row


def _is_last_admin(db: Session, member: User) -> bool:
    others = db.scalar(
        select(func.count(User.id)).where(
            User.role == UserRole.ADMIN,
            User.account_status == AccountStatus.ACTIVE,
            User.id != member.id,
        )
    )
    return not others


# ------------------------------------------------------------ restore


def restore(
    db: Session, *, member: User, actor: User, now: datetime | None = None
) -> AccountWithdrawal:
    """Undo a withdrawal within the grace period. Does not commit."""
    now = now or utcnow()
    row = open_withdrawal(db, member.id)
    if row is None:
        raise WithdrawalError("복구할 탈퇴 기록이 없습니다.", status_code=404)
    if not can_restore(row, now):
        raise WithdrawalError(
            f"탈퇴 후 {GRACE_PERIOD_DAYS}일이 지나 복구할 수 없습니다.", status_code=409
        )

    reversal = row.reversal or {}

    for item in reversal.get("memberships", []):
        membership = db.get(QuarterMembership, item["id"])
        # Only if nothing has moved it since — an admin may have set it by
        # hand in the meantime, and that later decision wins.
        if membership is not None and membership.status is MembershipStatus.FORMER:
            membership.status = MembershipStatus(item["status"])

    for item in reversal.get("applications", []):
        application = db.get(QuarterApplication, item["id"])
        if application is not None and application.status is ApplicationStatus.CANCELLED:
            application.status = ApplicationStatus(item["status"])

    restored_krw = 0
    for item in reversal.get("allocations", []):
        allocation = db.scalar(
            select(QuarterAllocation)
            .where(QuarterAllocation.id == item["id"])
            .with_for_update()
        )
        if allocation is None:
            continue
        # Added back rather than overwritten, so an adjustment an admin made
        # during the grace period is kept.
        allocation.build_budget_krw += item["build"]
        allocation.video_budget_krw += item["video"]
        allocation.community_total_budget_krw = (
            allocation.build_budget_krw + allocation.video_budget_krw
        )
        restored_krw += item["build"] + item["video"]

    for item in reversal.get("unpublished", []):
        model, ready, published = (
            (BuilderProject, BuilderProjectStatus.READY, BuilderProjectStatus.PUBLISHED)
            if item["kind"] == "builder"
            else (VideoProject, VideoProjectStatus.READY, VideoProjectStatus.PUBLISHED)
        )
        project = db.get(model, item["id"])
        if project is not None and project.status is ready and project.deleted_at is None:
            project.status = published

    balance = db.scalar(select(PersonalBalance).where(PersonalBalance.user_id == member.id))
    if balance is not None:
        balance.overage_enabled = bool(reversal.get("overage_enabled", False))

    if row.refund_status is RefundStatus.PENDING:
        # The member is back and keeps their money; nothing is owed.
        row.refund_status = RefundStatus.NONE

    member.account_status = AccountStatus.ACTIVE
    row.restored_at = now
    row.restored_by = actor.id

    audit.record(
        db,
        actor=actor,
        action=AuditAction.ACCOUNT_RESTORED,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=(
            f"{member.display_name}의 탈퇴를 취소하고 계정을 복구했습니다."
            + (f" 해제했던 동아리 지원 {restored_krw:,}원을 되돌렸습니다." if restored_krw else "")
        ),
        detail={"withdrawal_id": row.id, "restored_krw": restored_krw},
    )
    return row


# ------------------------------------------------------------ refund


def record_refund(
    db: Session,
    *,
    member: User,
    actor: User,
    reference: str = "",
    now: datetime | None = None,
) -> AccountWithdrawal:
    """Record that the member's personal money was returned. Does not commit.

    The refunded amount is what is left in the wallet *now*, not what was
    there at withdrawal: a top-up an admin confirmed afterwards is money
    the member is owed too.
    """
    now = now or utcnow()
    row = open_withdrawal(db, member.id)
    if row is None or row.refund_status is not RefundStatus.PENDING:
        raise WithdrawalError("환불 대기 중인 탈퇴가 없습니다.", status_code=409)

    if _pending_top_ups(db, member.id):
        raise WithdrawalError(
            "확인하지 않은 충전 요청이 있습니다. Top-ups에서 먼저 확인하거나 거절해 주세요.",
            status_code=409,
        )

    balance = db.scalar(
        select(PersonalBalance).where(PersonalBalance.user_id == member.id).with_for_update()
    )
    amount = balance.remaining_krw if balance else 0
    if balance is not None:
        # The money leaves the wallet. `consumed_krw` is usage and stays
        # as it was; only what was deposited is reduced.
        balance.balance_krw -= amount

    row.refund_status = RefundStatus.RECORDED
    row.refund_amount_krw = amount
    row.refund_recorded_at = now
    row.refund_recorded_by = actor.id
    row.refund_reference = reference.strip()[:200]

    audit.record(
        db,
        actor=actor,
        action=AuditAction.REFUND_RECORDED,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=f"{member.display_name}에게 개인 충전 잔액 {amount:,}원을 환불했다고 기록했습니다.",
        detail={"withdrawal_id": row.id, "amount_krw": amount, "reference": row.refund_reference},
    )
    return row


# ------------------------------------------------------------ anonymise


def due_for_anonymisation(db: Session, now: datetime | None = None) -> list[AccountWithdrawal]:
    """Open withdrawals whose grace period is over and not yet anonymised.

    Includes the ones still waiting for a refund, so the job can report
    them; `anonymise` refuses those.
    """
    now = now or utcnow()
    return list(
        db.scalars(
            select(AccountWithdrawal)
            .where(
                AccountWithdrawal.restored_at.is_(None),
                AccountWithdrawal.anonymised_at.is_(None),
                AccountWithdrawal.grace_ends_at <= now,
            )
            .order_by(AccountWithdrawal.id)
        )
    )


def anonymise(db: Session, row: AccountWithdrawal, now: datetime | None = None) -> User:
    """Remove a withdrawn member's personal fields. Does not commit.

    What goes: username, email, display name and the password hash (there
    is no avatar column yet). What stays: the row itself, so usage events,
    allocations and quarter reports keep pointing at a member and still
    add up, and published work still has someone to attribute to — now
    simply 탈퇴 회원.

    The audit log is left as it is: it is append-only, and only admins can
    read it. The row written here carries no personal data.
    """
    now = now or utcnow()
    if row.refund_status is RefundStatus.PENDING:
        raise WithdrawalError("환불을 기록하기 전에는 개인정보를 삭제할 수 없습니다.", 409)
    if not row.is_open or row.anonymised_at is not None or now < _aware(row.grace_ends_at):
        raise WithdrawalError("아직 개인정보를 삭제할 수 없는 탈퇴입니다.", 409)

    member = db.get(User, row.user_id)
    member.username = anonymised_username(member.id)
    # RFC 2606 reserves example.com, so this can never reach anyone. Not
    # `.invalid`, which is reserved too but fails `EmailStr` and would
    # break every response schema that carries the address.
    member.email = f"{anonymised_username(member.id)}@withdrawn.example.com"
    member.display_name = ANONYMISED_DISPLAY_NAME
    member.password_hash = UNUSABLE_PASSWORD_HASH
    member.account_status = AccountStatus.FORMER
    db.execute(delete(UserSession).where(UserSession.user_id == member.id))
    row.anonymised_at = now

    audit.record(
        db,
        actor=None,
        action=AuditAction.ACCOUNT_ANONYMISED,
        target_type="user",
        target_id=member.id,
        target_label=member.username,
        summary=f"탈퇴 후 {GRACE_PERIOD_DAYS}일이 지나 개인정보를 삭제했습니다.",
        detail={"withdrawal_id": row.id},
    )
    return member
