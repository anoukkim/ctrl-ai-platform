"""Where the money went (cost-clarity, 2026-10-14).

The owner's goal: *I (owner) and every member can see exactly where money
went, including what caching saved.* Everything here **reads** the usage
ledger, except the three admin actions at the end (a wallet adjustment,
closing a quarter, carrying last quarter's money over), each of which
writes its own record and an audit row in the caller's transaction.

## The split

Since cost-clarity every Claude charge stores its dollar cost split by
part — input, cache write, cache read, output, tools — and what caching
saved (`UsageEvent.*_cost_usd`, `cache_saved_usd`). In won, a part is its
dollars × the event's own exchange rate: the parts are **unrounded**, and
the member's `charged_krw` is their sum rounded **up** once (pricing.py).
So the parts of one reply may add up to 3.4원 for a 4원 charge; the screen
says the total is rounded up.

Rows from before the split have tokens but no parts. They are priced
again from the current catalogue and marked `estimated` — never written
back. Anything not priced by the token (a video) is all `other`.

## Days

Days are KST calendar days, as for the daily cap (`chat_limits.KST`).
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_FLOOR, Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import (
    AdjustmentKind,
    AuditAction,
    ChatModel,
    Conversation,
    CreditPurchase,
    FundingSource,
    Quarter,
    QuarterAllocation,
    QuarterMembership,
    QuarterStatus,
    UsageEvent,
    UsageFeature,
    User,
    WalletAdjustment,
)
from app.models.usage import spending_group
from app.services import audit
from app.services.chat_limits import KST
from app.services.pricing import CACHE_WRITE_MULTIPLIER, DEFAULT_CACHE_READ_RATIO, MILLION

#: The parts of a charge, in the order every screen and CSV shows them.
PARTS: tuple[str, ...] = ("input", "cache_write", "cache_read", "output", "tools", "other")
PART_LABEL: dict[str, str] = {
    "input": "입력",
    "cache_write": "캐시 쓰기",
    "cache_read": "캐시 읽기",
    "output": "출력",
    "tools": "도구",
    "other": "기타",
}
#: Ledger providers that are one purchase (as in quarter_budget).
PROVIDER_KEY = {"anthropic": "claude"}
PROVIDER_LABEL = {"claude": "Anthropic (Claude)", "higgsfield": "Higgsfield"}
#: Purchases can be recorded for these, Anthropic first.
PURCHASE_PROVIDERS: tuple[str, ...] = ("claude", "higgsfield")
GROUP_LABEL = {"chat": "채팅", "build": "빌더", "video": "영상", "other": "기타"}


def provider_key(provider: str) -> str:
    return PROVIDER_KEY.get(provider, provider)


def kst_day(moment: datetime) -> date:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(KST).date()


def _won(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


# ------------------------------------------------------------- the split


@dataclass
class WonSplit:
    """One charge — or a sum of charges — by part, in unrounded won."""

    input: Decimal = Decimal(0)
    cache_write: Decimal = Decimal(0)
    cache_read: Decimal = Decimal(0)
    output: Decimal = Decimal(0)
    tools: Decimal = Decimal(0)
    other: Decimal = Decimal(0)
    cache_saved: Decimal = Decimal(0)
    charged_krw: int = 0
    events: int = 0
    #: True when any part was re-priced from today's catalogue (a row
    #: from before the split) rather than read from the ledger.
    estimated: bool = False

    def add(self, other: "WonSplit") -> None:
        for name in (*PARTS, "cache_saved"):
            setattr(self, name, getattr(self, name) + getattr(other, name))
        self.charged_krw += other.charged_krw
        self.events += other.events
        self.estimated = self.estimated or other.estimated

    def as_dict(self) -> dict[str, float | int | bool]:
        out: dict[str, float | int | bool] = {
            f"{name}_krw": _won(getattr(self, name)) for name in PARTS
        }
        out["cache_saved_krw"] = _won(self.cache_saved)
        out["charged_krw"] = self.charged_krw
        out["events"] = self.events
        out["estimated"] = self.estimated
        return out


@dataclass(frozen=True)
class _CataloguePrice:
    input: Decimal
    output: Decimal
    cache_read: Decimal


def catalogue_prices(db: Session) -> dict[str, _CataloguePrice]:
    """Today's per-million prices by model id — only for re-pricing old rows."""
    prices: dict[str, _CataloguePrice] = {}
    for row in db.scalars(select(ChatModel)):
        read = row.cache_read_usd_per_mtok
        prices[row.model_id] = _CataloguePrice(
            input=row.input_usd_per_mtok,
            output=row.output_usd_per_mtok,
            cache_read=read if read is not None else row.input_usd_per_mtok * DEFAULT_CACHE_READ_RATIO,
        )
    return prices


def split_of(event: UsageEvent, prices: dict[str, _CataloguePrice] | None = None) -> WonSplit:
    """One event's charge by part, in won (see the module note)."""
    rate = Decimal(event.exchange_rate_krw or 0)
    out = WonSplit(charged_krw=event.charged_krw, events=1)
    if event.input_cost_usd is not None:
        out.input = Decimal(event.input_cost_usd) * rate
        out.cache_write = Decimal(event.cache_write_cost_usd or 0) * rate
        out.cache_read = Decimal(event.cache_read_cost_usd or 0) * rate
        out.output = Decimal(event.output_cost_usd or 0) * rate
        out.tools = Decimal(event.tool_cost_usd or 0) * rate
        out.cache_saved = Decimal(event.cache_saved_usd or 0) * rate
        return out

    has_tokens = event.input_tokens is not None or event.output_tokens is not None
    price = (prices or {}).get(event.model_id or "")
    if has_tokens and price is not None and rate > 0:
        # A row from before the split: re-priced from today's catalogue.
        written = Decimal(event.cache_write_tokens or 0)
        read = Decimal(event.cache_read_tokens or 0)
        out.input = Decimal(event.input_tokens or 0) * price.input / MILLION * rate
        out.cache_write = written * price.input * CACHE_WRITE_MULTIPLIER["5m"] / MILLION * rate
        out.cache_read = read * price.cache_read / MILLION * rate
        out.output = Decimal(event.output_tokens or 0) * price.output / MILLION * rate
        out.tools = Decimal(event.tool_fee_krw or 0)
        out.cache_saved = read * (price.input - price.cache_read) / MILLION * rate
        out.estimated = True
        return out

    # Not priced by the token (video), or no price to re-price with.
    out.other = Decimal(event.charged_krw)
    return out


def receipt_fields(event: UsageEvent, prices: dict[str, _CataloguePrice] | None = None) -> dict:
    """The receipt's won split for one reply: what `ReplyReceipt` adds."""
    split = split_of(event, prices)
    return {
        "input_krw": _won(split.input),
        "cache_write_krw": _won(split.cache_write),
        "cache_read_krw": _won(split.cache_read),
        "output_krw": _won(split.output),
        "tool_krw": _won(split.tools),
        "cache_saved_krw": _won(split.cache_saved),
        "split_estimated": split.estimated,
    }


# ------------------------------------------------------ the member's Usage


def _member_events(db: Session, user_id: int, quarter_id: int) -> list[UsageEvent]:
    return list(
        db.scalars(
            select(UsageEvent)
            .where(
                UsageEvent.user_id == user_id,
                UsageEvent.quarter_id == quarter_id,
                UsageEvent.club_absorbed.is_(False),
            )
            .order_by(UsageEvent.created_at, UsageEvent.id)
        )
    )


@dataclass
class ConversationTotal:
    conversation_id: int | None
    title: str
    last_at: datetime
    split: WonSplit = field(default_factory=WonSplit)


@dataclass
class DayTotal:
    day: date
    split: WonSplit = field(default_factory=WonSplit)


@dataclass
class MemberMoney:
    by_conversation: list[ConversationTotal]
    by_day: list[DayTotal]
    quarter: WonSplit


def member_money(db: Session, user_id: int, quarter_id: int) -> MemberMoney:
    """The Usage screen's per-conversation and per-day totals, this quarter.

    Both pots count here (it is what the member spent); a club-absorbed
    row is not theirs and is left out.
    """
    prices = catalogue_prices(db)
    conversations: dict[int | None, ConversationTotal] = {}
    days: dict[date, DayTotal] = {}
    quarter_total = WonSplit()
    for event in _member_events(db, user_id, quarter_id):
        split = split_of(event, prices)
        quarter_total.add(split)
        day = kst_day(event.created_at)
        days.setdefault(day, DayTotal(day=day)).split.add(split)
        if event.feature == UsageFeature.CHAT.value:
            key = event.conversation_id
            total = conversations.get(key)
            if total is None:
                total = conversations[key] = ConversationTotal(
                    conversation_id=key, title="", last_at=event.created_at
                )
            total.split.add(split)
            total.last_at = max(total.last_at, event.created_at)

    titles = {
        row.id: row.title
        for row in db.scalars(
            select(Conversation).where(
                Conversation.id.in_([key for key in conversations if key is not None])
            )
        )
    }
    for key, total in conversations.items():
        if key is not None and key in titles:
            total.title = titles[key] or "제목 없는 대화"
        else:
            # Deleting a conversation is a real delete; the money stays.
            total.title = "삭제된 대화"
            total.conversation_id = None
    return MemberMoney(
        by_conversation=sorted(conversations.values(), key=lambda t: t.last_at, reverse=True),
        by_day=sorted(days.values(), key=lambda t: t.day, reverse=True),
        quarter=quarter_total,
    )


# ---------------------------------------------------------- Admin › Budget


@dataclass
class ProviderCredit:
    provider: str
    label: str
    purchased_usd: Decimal
    paid_krw: int
    purchases: int
    #: provider_cost over all time, USD — what the ledger says the club used.
    used_usd: Decimal
    #: Of it, calls nobody was charged for (club_absorbed).
    absorbed_usd: Decimal
    #: charged_krw over all time — what left members' wallets.
    used_krw: int
    used_usd_quarter: Decimal
    used_krw_quarter: int
    #: Events with no provider_cost (video today): KRW only.
    unpriced_events: int

    @property
    def remaining_usd(self) -> Decimal:
        return self.purchased_usd - self.used_usd


def provider_credit(db: Session, quarter: Quarter | None) -> list[ProviderCredit]:
    """Per provider: bought, used (ledger), estimated remaining.

    Credit is not per quarter — it runs until spent or expired — so the
    balance is all purchases minus all recorded use; this quarter's use is
    shown beside it.
    """
    bought: dict[str, list] = defaultdict(lambda: [Decimal(0), 0, 0])
    for provider, usd, krw, count in db.execute(
        select(
            CreditPurchase.provider,
            func.coalesce(func.sum(CreditPurchase.amount_usd), 0),
            func.coalesce(func.sum(CreditPurchase.paid_krw), 0),
            func.count(CreditPurchase.id),
        ).group_by(CreditPurchase.provider)
    ):
        line = bought[provider_key(provider)]
        line[0] += Decimal(str(usd))
        line[1] += int(krw)
        line[2] += int(count)

    used: dict[str, dict] = defaultdict(
        lambda: {"usd": Decimal(0), "absorbed": Decimal(0), "krw": 0, "q_usd": Decimal(0), "q_krw": 0, "unpriced": 0}
    )
    for provider, absorbed, in_quarter, cost, krw, unpriced in db.execute(
        select(
            UsageEvent.provider,
            UsageEvent.club_absorbed,
            (UsageEvent.quarter_id == (quarter.id if quarter else -1)),
            func.coalesce(func.sum(UsageEvent.provider_cost), 0),
            func.coalesce(func.sum(UsageEvent.charged_krw), 0),
            func.sum(case((UsageEvent.provider_cost.is_(None), 1), else_=0)),
        ).group_by(
            UsageEvent.provider,
            UsageEvent.club_absorbed,
            (UsageEvent.quarter_id == (quarter.id if quarter else -1)),
        )
    ):
        line = used[provider_key(provider)]
        cost = Decimal(str(cost))
        line["usd"] += cost
        line["krw"] += int(krw)
        line["unpriced"] += int(unpriced or 0)
        if absorbed:
            line["absorbed"] += cost
        if in_quarter:
            line["q_usd"] += cost
            line["q_krw"] += int(krw)

    keys = list(PURCHASE_PROVIDERS) + sorted(
        key for key in set(bought) | set(used) if key not in PURCHASE_PROVIDERS
    )
    result = []
    for key in keys:
        if key not in bought and key not in used and key not in PURCHASE_PROVIDERS:
            continue
        b = bought.get(key, [Decimal(0), 0, 0])
        u = used.get(key, used.default_factory())
        result.append(
            ProviderCredit(
                provider=key,
                label=PROVIDER_LABEL.get(key, key),
                purchased_usd=b[0],
                paid_krw=b[1],
                purchases=b[2],
                used_usd=u["usd"],
                absorbed_usd=u["absorbed"],
                used_krw=u["krw"],
                used_usd_quarter=u["q_usd"],
                used_krw_quarter=u["q_krw"],
                unpriced_events=u["unpriced"],
            )
        )
    return result


def purchases(db: Session) -> list[tuple[CreditPurchase, str]]:
    """Every purchase, newest first, with who recorded it."""
    rows = db.execute(
        select(CreditPurchase, User.username)
        .outerjoin(User, User.id == CreditPurchase.created_by)
        .order_by(CreditPurchase.purchased_on.desc(), CreditPurchase.id.desc())
    ).all()
    return [(purchase, username or "") for purchase, username in rows]


def record_purchase(
    db: Session,
    *,
    admin: User,
    provider: str,
    purchased_on: date,
    amount_usd: Decimal,
    paid_krw: int,
    memo: str,
) -> CreditPurchase:
    """Append one purchase and its audit row. Does not commit."""
    row = CreditPurchase(
        provider=provider,
        purchased_on=purchased_on,
        amount_usd=amount_usd,
        paid_krw=paid_krw,
        memo=memo,
        created_by=admin.id,
    )
    db.add(row)
    db.flush()
    label = PROVIDER_LABEL.get(provider, provider)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.CREDIT_PURCHASE_RECORDED,
        target_type="credit_purchase",
        target_id=row.id,
        target_label=label,
        summary=(
            f"{label} 크레딧 구매를 기록했습니다: {purchased_on.isoformat()}, "
            f"${amount_usd:,.2f}, {paid_krw:,}원"
        ),
        detail={
            "provider": provider,
            "purchased_on": purchased_on.isoformat(),
            "amount_usd": str(amount_usd),
            "paid_krw": paid_krw,
            "memo": memo,
        },
    )
    return row


@dataclass
class MemberRow:
    user_id: int
    username: str
    display_name: str
    membership_status: str | None
    granted_krw: int
    consumed_krw: int
    remaining_krw: int
    by_group: dict[str, int]
    cache_saved_krw: float
    adjusted_krw: int
    carried_in_krw: int
    frozen: bool
    reclaimed_krw: int | None
    carry_over_krw: int | None


def member_rows(db: Session, quarter: Quarter) -> list[MemberRow]:
    """Admin › Budget's per-member table: granted, spent by 채팅/빌더/영상/기타,
    and what caching saved them."""
    prices = catalogue_prices(db)
    spent: dict[int, dict[str, int]] = defaultdict(
        lambda: {"chat": 0, "build": 0, "video": 0, "other": 0}
    )
    saved: dict[int, Decimal] = defaultdict(Decimal)
    for event in db.scalars(
        select(UsageEvent).where(
            UsageEvent.quarter_id == quarter.id,
            UsageEvent.funding_source == FundingSource.COMMUNITY,
            UsageEvent.club_absorbed.is_(False),
        )
    ):
        spent[event.user_id][spending_group(event.feature)] += event.charged_krw
        saved[event.user_id] += split_of(event, prices).cache_saved

    adjustments: dict[tuple[int, str], int] = defaultdict(int)
    for user_id, kind, amount in db.execute(
        select(WalletAdjustment.user_id, WalletAdjustment.kind, func.sum(WalletAdjustment.amount_krw))
        .where(WalletAdjustment.quarter_id == quarter.id)
        .group_by(WalletAdjustment.user_id, WalletAdjustment.kind)
    ):
        adjustments[(user_id, kind)] += int(amount or 0)

    rows = db.execute(
        select(QuarterAllocation, User, QuarterMembership.status)
        .join(User, User.id == QuarterAllocation.user_id)
        .outerjoin(
            QuarterMembership,
            (QuarterMembership.user_id == QuarterAllocation.user_id)
            & (QuarterMembership.quarter_id == quarter.id),
        )
        .where(QuarterAllocation.quarter_id == quarter.id)
        .order_by(QuarterAllocation.consumed_krw.desc(), User.username)
    ).all()
    return [
        MemberRow(
            user_id=member.id,
            username=member.username,
            display_name=member.display_name,
            membership_status=status.value if status is not None else None,
            granted_krw=allocation.budget_krw,
            consumed_krw=allocation.consumed_krw,
            remaining_krw=allocation.remaining_krw,
            by_group=dict(spent[member.id]),
            cache_saved_krw=_won(saved[member.id]),
            adjusted_krw=adjustments[(member.id, AdjustmentKind.ADJUST.value)],
            carried_in_krw=adjustments[(member.id, AdjustmentKind.CARRY_OVER.value)],
            frozen=allocation.frozen_at is not None,
            reclaimed_krw=allocation.reclaimed_krw,
            carry_over_krw=allocation.carry_over_krw,
        )
        for allocation, member, status in rows
    ]


@dataclass
class CacheRow:
    day: date
    model_id: str
    replies: int
    hit_replies: int
    input_tokens: int
    write_tokens: int
    read_tokens: int
    write_krw: Decimal
    saved_krw: Decimal
    estimated: bool

    @property
    def hit_rate(self) -> float | None:
        prompt = self.input_tokens + self.write_tokens + self.read_tokens
        return self.read_tokens / prompt if prompt else None


def cache_panel(db: Session, days: int = 14) -> list[CacheRow]:
    """Per model and KST day: hit rate, tokens read/written, won saved.

    Chat replies only — the Builder and the prompt helper send no cache
    marker, and counting them would deflate the rate.
    """
    prices = catalogue_prices(db)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows: dict[tuple[date, str], CacheRow] = {}
    for event in db.scalars(
        select(UsageEvent).where(
            UsageEvent.feature == UsageFeature.CHAT.value,
            UsageEvent.model_id.is_not(None),
            UsageEvent.created_at >= cutoff,
        )
    ):
        day = kst_day(event.created_at)
        row = rows.get((day, event.model_id))
        if row is None:
            row = rows[(day, event.model_id)] = CacheRow(
                day=day, model_id=event.model_id, replies=0, hit_replies=0,
                input_tokens=0, write_tokens=0, read_tokens=0,
                write_krw=Decimal(0), saved_krw=Decimal(0), estimated=False,
            )
        split = split_of(event, prices)
        row.replies += 1
        read = event.cache_read_tokens or 0
        row.hit_replies += 1 if read > 0 else 0
        row.input_tokens += event.input_tokens or 0
        row.write_tokens += event.cache_write_tokens or 0
        row.read_tokens += read
        row.write_krw += split.cache_write
        row.saved_krw += split.cache_saved
        row.estimated = row.estimated or split.estimated
    return sorted(rows.values(), key=lambda r: (r.day, r.model_id), reverse=True)


def daily_totals(db: Session, quarter: Quarter) -> list[DayTotal]:
    """The quarter's spend per KST day, every member, by part."""
    prices = catalogue_prices(db)
    days: dict[date, DayTotal] = {}
    for event in db.scalars(
        select(UsageEvent).where(UsageEvent.quarter_id == quarter.id).order_by(UsageEvent.created_at)
    ):
        day = kst_day(event.created_at)
        days.setdefault(day, DayTotal(day=day)).split.add(split_of(event, prices))
    return sorted(days.values(), key=lambda t: t.day, reverse=True)


def provider_usd_by_utc_day(db: Session, start: date, end: date) -> dict[date, Decimal]:
    """Our recorded Anthropic cost per **UTC** day, for reconciliation —
    Anthropic's cost report buckets by UTC day."""
    begin = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    finish = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    totals: dict[date, Decimal] = defaultdict(Decimal)
    for created, cost in db.execute(
        select(UsageEvent.created_at, UsageEvent.provider_cost).where(
            UsageEvent.provider.in_(("claude", "anthropic")),
            UsageEvent.provider_currency == "USD",
            UsageEvent.provider_cost.is_not(None),
            UsageEvent.created_at >= begin,
            UsageEvent.created_at < finish,
        )
    ):
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        totals[created.astimezone(timezone.utc).date()] += Decimal(str(cost))
    return dict(totals)


# ------------------------------------------------------------ CSV exports


def csv_bytes(header: list[str], rows: list[list]) -> bytes:
    """UTF-8 with a BOM, so Excel in Korea opens the Korean columns right."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(header)
    writer.writerows(rows)
    return ("﻿" + buffer.getvalue()).encode("utf-8")


def members_csv(db: Session, quarter: Quarter) -> bytes:
    header = [
        "분기", "아이디", "이름", "참여 상태", "지급(원)", "채팅(원)", "빌더(원)", "영상(원)",
        "기타(원)", "사용 합계(원)", "남음(원)", "캐시로 아낀 금액(원)", "조정 합계(원)",
        "이월 받음(원)", "마감", "회수(원)", "다음 분기로 이월(원)",
    ]
    rows = [
        [
            quarter.code, row.username, row.display_name, row.membership_status or "",
            row.granted_krw, row.by_group["chat"], row.by_group["build"], row.by_group["video"],
            row.by_group["other"], row.consumed_krw, row.remaining_krw, row.cache_saved_krw,
            row.adjusted_krw, row.carried_in_krw, "예" if row.frozen else "",
            row.reclaimed_krw if row.reclaimed_krw is not None else "",
            row.carry_over_krw if row.carry_over_krw is not None else "",
        ]
        for row in member_rows(db, quarter)
    ]
    return csv_bytes(header, rows)


def daily_csv(db: Session, quarter: Quarter) -> bytes:
    header = ["날짜(KST)", "건수", "차감 합계(원)"] + [
        f"{PART_LABEL[name]}(원)" for name in PARTS
    ] + ["캐시로 아낀 금액(원)", "추정 포함"]
    rows = []
    for total in daily_totals(db, quarter):
        split = total.split
        rows.append(
            [total.day.isoformat(), split.events, split.charged_krw]
            + [_won(getattr(split, name)) for name in PARTS]
            + [_won(split.cache_saved), "예" if split.estimated else ""]
        )
    return csv_bytes(header, rows)


def purchases_csv(db: Session) -> bytes:
    header = ["구매일", "제공자", "크레딧(USD)", "실제 결제(원)", "메모", "기록한 사람", "기록 시각(UTC)"]
    rows = [
        [
            purchase.purchased_on.isoformat(),
            PROVIDER_LABEL.get(purchase.provider, purchase.provider),
            f"{Decimal(purchase.amount_usd):.2f}",
            purchase.paid_krw,
            purchase.memo,
            username,
            purchase.created_at.isoformat() if purchase.created_at else "",
        ]
        for purchase, username in purchases(db)
    ]
    return csv_bytes(header, rows)


def caching_csv(db: Session, days: int) -> bytes:
    header = [
        "날짜(KST)", "모델", "답장 수", "캐시 적중 답장", "적중률", "새 입력 토큰",
        "캐시에 쓴 토큰", "캐시에서 읽은 토큰", "캐시 쓰기(원)", "캐시로 아낀 금액(원)", "추정 포함",
    ]
    rows = [
        [
            row.day.isoformat(), row.model_id, row.replies, row.hit_replies,
            f"{row.hit_rate:.3f}" if row.hit_rate is not None else "",
            row.input_tokens, row.write_tokens, row.read_tokens, _won(row.write_krw),
            _won(row.saved_krw), "예" if row.estimated else "",
        ]
        for row in cache_panel(db, days)
    ]
    return csv_bytes(header, rows)


# --------------------------------------------------- admin money actions


class AccountingError(Exception):
    """A refused admin money action. Korean message, HTTP status."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def adjust_wallet(
    db: Session, *, admin: User, quarter: Quarter, user_id: int, amount_krw: int, reason: str
) -> WalletAdjustment:
    """Move one member's wallet by `amount_krw`, with a reason. Not commit.

    An adjustment row, never an overwrite (owner, 2026-10-14). Refused on
    a closed quarter's frozen wallet, and below what is already spent —
    money that already left cannot be taken back by lowering the total.
    """
    allocation = db.scalar(
        select(QuarterAllocation)
        .where(QuarterAllocation.user_id == user_id, QuarterAllocation.quarter_id == quarter.id)
        .with_for_update()
    )
    if allocation is None:
        raise AccountingError("승인된 지원금이 없습니다. 먼저 참여 신청을 승인해 주세요.", 404)
    if allocation.frozen_at is not None:
        raise AccountingError("마감된 분기의 지갑은 바꿀 수 없습니다.", 409)
    reason = reason.strip()
    if not reason:
        raise AccountingError("조정 사유를 적어 주세요.")
    if amount_krw == 0:
        raise AccountingError("0원은 조정할 수 없습니다.")
    after = allocation.budget_krw + amount_krw
    if after < allocation.consumed_krw:
        raise AccountingError(
            f"이미 쓴 {allocation.consumed_krw:,}원보다 적게 줄일 수 없습니다. "
            f"최대 {allocation.budget_krw - allocation.consumed_krw:,}원까지 줄일 수 있습니다."
        )
    member = db.get(User, user_id)
    row = WalletAdjustment(
        allocation_id=allocation.id,
        user_id=user_id,
        quarter_id=quarter.id,
        amount_krw=amount_krw,
        kind=AdjustmentKind.ADJUST.value,
        reason=reason,
        budget_before_krw=allocation.budget_krw,
        budget_after_krw=after,
        created_by=admin.id,
    )
    db.add(row)
    before = allocation.budget_krw
    allocation.budget_krw = after
    db.flush()
    name = member.display_name if member else str(user_id)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.ALLOCATION_ADJUSTED,
        target_type="allocation",
        target_id=allocation.id,
        target_label=member.username if member else str(user_id),
        summary=(
            f"{name}의 {quarter.display_name} 동아리 지원을 {amount_krw:+,}원 조정했습니다 "
            f"({before:,}원 → {after:,}원). 사유: {reason[:80]}"
        ),
        detail={
            "adjustment_id": row.id,
            "amount_krw": amount_krw,
            "before": {"budget_krw": before},
            "after": {"budget_krw": after},
            "reason": reason,
        },
    )
    return row


def adjustments_for(db: Session, user_id: int) -> list[tuple[WalletAdjustment, str, str]]:
    """One member's adjustment history, newest first, with the quarter's
    name and who made each."""
    rows = db.execute(
        select(WalletAdjustment, Quarter.display_name, User.username)
        .join(Quarter, Quarter.id == WalletAdjustment.quarter_id)
        .outerjoin(User, User.id == WalletAdjustment.created_by)
        .where(WalletAdjustment.user_id == user_id)
        .order_by(WalletAdjustment.id.desc())
    ).all()
    return [(row, quarter_name, username or "") for row, quarter_name, username in rows]


@dataclass
class CloseLine:
    user_id: int
    username: str
    display_name: str
    budget_krw: int
    consumed_krw: int
    reclaimed_krw: int
    carry_over_krw: int


def carry_amount(remaining_krw: int, percent: int) -> int:
    """The carried part, rounded down to whole won — the club keeps the rest."""
    return int((Decimal(remaining_krw) * Decimal(percent) / 100).to_integral_value(ROUND_FLOOR))


def close_preview(db: Session, quarter: Quarter, percent: int) -> list[CloseLine]:
    rows = db.execute(
        select(QuarterAllocation, User)
        .join(User, User.id == QuarterAllocation.user_id)
        .where(QuarterAllocation.quarter_id == quarter.id)
        .order_by(User.username)
    ).all()
    return [
        CloseLine(
            user_id=member.id,
            username=member.username,
            display_name=member.display_name,
            budget_krw=allocation.budget_krw,
            consumed_krw=allocation.consumed_krw,
            reclaimed_krw=allocation.remaining_krw,
            carry_over_krw=carry_amount(allocation.remaining_krw, percent),
        )
        for allocation, member in rows
    ]


def close_quarter(db: Session, *, admin: User, quarter: Quarter, percent: int) -> list[CloseLine]:
    """분기 마감: freeze every wallet, record 회수 and the carry-over. Not commit.

    Nothing is deleted. The quarter becomes `closed`, so `current_quarter`
    no longer offers it and `charge()` refuses its frozen wallets.
    """
    if quarter.status is QuarterStatus.CLOSED or quarter.closed_at is not None:
        raise AccountingError("이미 마감한 분기입니다.", 409)
    if quarter.status is QuarterStatus.DRAFT:
        raise AccountingError("초안 분기는 마감할 수 없습니다. 지우지 말고 그대로 두세요.", 409)
    if not 0 <= percent <= 100:
        raise AccountingError("이월 비율은 0에서 100 사이여야 합니다.")

    now = datetime.now(timezone.utc)
    allocations = list(
        db.scalars(
            select(QuarterAllocation)
            .where(QuarterAllocation.quarter_id == quarter.id)
            .with_for_update()
        )
    )
    for allocation in allocations:
        remaining = allocation.remaining_krw
        allocation.frozen_at = now
        allocation.reclaimed_krw = remaining
        allocation.carry_over_krw = carry_amount(remaining, percent)

    before = quarter.status
    quarter.status = QuarterStatus.CLOSED
    quarter.closed_at = now
    quarter.closed_by = admin.id
    quarter.carry_over_percent = percent
    db.flush()
    lines = close_preview(db, quarter, percent)
    reclaimed = sum(line.reclaimed_krw for line in lines)
    carried = sum(line.carry_over_krw for line in lines)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.QUARTER_CLOSED,
        target_type="quarter",
        target_id=quarter.id,
        target_label=quarter.code,
        summary=(
            f"{quarter.display_name} 분기를 마감했습니다. 지갑 {len(lines)}개를 멈추고 "
            f"남은 {reclaimed:,}원을 회수, 그중 {carried:,}원({percent}%)은 다음 분기로 이월합니다."
        ),
        detail={
            "before_status": before.value,
            "carry_over_percent": percent,
            "wallets": len(lines),
            "reclaimed_krw": reclaimed,
            "carry_over_krw": carried,
        },
    )
    return lines


def apply_carry_over(db: Session, *, admin: User, allocation: QuarterAllocation) -> int:
    """At approval: add the member's unapplied carry-over to this wallet.

    The newest closed wallet of the same member with carry-over left and
    not yet applied; once applied it is marked, so it never lands twice.
    Returns the won added (0 when there is none). Does not commit.
    """
    previous = db.scalar(
        select(QuarterAllocation)
        .where(
            QuarterAllocation.user_id == allocation.user_id,
            QuarterAllocation.id != allocation.id,
            QuarterAllocation.frozen_at.is_not(None),
            QuarterAllocation.carry_over_krw > 0,
            QuarterAllocation.carried_into_id.is_(None),
        )
        .order_by(QuarterAllocation.frozen_at.desc())
        .with_for_update()
    )
    if previous is None:
        return 0
    amount = int(previous.carry_over_krw or 0)
    before = allocation.budget_krw
    allocation.budget_krw = before + amount
    previous.carried_into_id = allocation.id
    from_quarter = db.get(Quarter, previous.quarter_id)
    to_quarter = db.get(Quarter, allocation.quarter_id)
    db.add(
        WalletAdjustment(
            allocation_id=allocation.id,
            user_id=allocation.user_id,
            quarter_id=allocation.quarter_id,
            amount_krw=amount,
            kind=AdjustmentKind.CARRY_OVER.value,
            reason=f"{from_quarter.display_name if from_quarter else '지난 분기'}에서 이월",
            budget_before_krw=before,
            budget_after_krw=allocation.budget_krw,
            created_by=admin.id,
        )
    )
    member = db.get(User, allocation.user_id)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.ALLOCATION_CARRIED_OVER,
        target_type="allocation",
        target_id=allocation.id,
        target_label=member.username if member else str(allocation.user_id),
        summary=(
            f"{member.display_name if member else allocation.user_id}의 "
            f"{from_quarter.display_name if from_quarter else '지난 분기'} 남은 지원금 중 "
            f"{amount:,}원을 {to_quarter.display_name if to_quarter else '이번 분기'}로 이월했습니다."
        ),
        detail={"amount_krw": amount, "from_allocation_id": previous.id},
    )
    return amount
