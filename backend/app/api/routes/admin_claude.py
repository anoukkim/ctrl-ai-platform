"""Admin › System — the won-per-dollar rate and how Claude is called.

Two figures decide what every Chat reply and prompt-helper call costs a
member: the per-model token price and the won-per-dollar rate. The rate
is edited here; the prices live with the models in Admin › AI Models
(`admin_chat_models.py`). Both changes are written to the audit log,
because they move what every later call is charged.

Admin-only, and — like every other Admin screen — not gated on
participation: setting prices is administration, not creation.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AuditAction, BuilderEvalReport, ChatLimits, ExchangeRate, User
from app.schemas.builder import EmptyBody
from app.schemas.pricing import (
    FxStatusRead,
    FxAutoWrite,
    ChatLimitsRead,
    ChatLimitsWrite,
    ClaudeSettingsRead,
    ExchangeRateRead,
    ExchangeRateWrite,
)
from app.services import audit, chat_limits, chat_models, fx, pricing
from app.services import depth as depth_service

router = APIRouter(prefix="/admin/claude-pricing", tags=["admin"])


def _rate_read(db: Session, row: ExchangeRate) -> ExchangeRateRead:
    who = db.get(User, row.set_by) if row.set_by else None
    return ExchangeRateRead(
        krw_per_usd=row.krw_per_unit,
        set_at=row.created_at,
        set_by_username=who.username if who else "",
        source=row.source,
        fetched_for=row.fetched_for,
    )


def _fx_read(db: Session, settings: Settings) -> FxStatusRead:
    row = fx.status_row(db)
    return FxStatusRead(
        provider=settings.provider_mode("fx"),
        is_mock=settings.provider_is_mock("fx"),
        auto_enabled=row.auto_enabled,
        checked_at=row.checked_at,
        fetched_rate=row.fetched_rate,
        fetched_for=row.fetched_for,
        outcome=row.outcome,
        outcome_label=fx.OUTCOME_LABEL.get(row.outcome, ""),
        note=row.note,
        max_jump_pct=fx.MAX_JUMP_PCT,
    )


def _limits_read(db: Session) -> ChatLimitsRead:
    row = db.scalar(select(ChatLimits).order_by(ChatLimits.id.desc()).limit(1))
    limits = chat_limits.current(db)
    who = db.get(User, row.set_by) if row is not None and row.set_by else None
    return ChatLimitsRead(
        reply_cap_krw=limits.reply_cap_krw,
        long_history_tokens=limits.long_history_tokens,
        daily_cap_krw=limits.daily_cap_krw,
        provider_concurrency=limits.provider_concurrency,
        web_fetch_max_uses=limits.web_fetch_max_uses,
        web_fetch_max_content_tokens=limits.web_fetch_max_content_tokens,
        web_search_max_uses=limits.web_search_max_uses,
        app_ai_daily_cap_krw=limits.app_ai_daily_cap_krw,
        depth_levels=depth_service.full_table(limits.depth_levels),
        context_tokens=limits.context_tokens,
        timeout_seconds=limits.timeout_seconds,
        set_at=row.created_at if row is not None else None,
        set_by_username=who.username if who else "",
    )


def _settings_read(db: Session, settings: Settings) -> ClaudeSettingsRead:
    current = pricing.current_rate(db)
    default = chat_models.default_row(db)
    return ClaudeSettingsRead(
        is_mock=settings.provider_is_mock("claude"),
        default_model_label=default.label if default else "",
        default_model_id=default.model_id if default else "",
        fallback_model=settings.anthropic_model.strip(),
        thinking=settings.chat_thinking,
        effort=settings.chat_effort,
        # quality-tuning Q1: 보통's room and the admin's history budget.
        max_output_tokens=depth_service.table(chat_limits.current(db).depth_levels, "chat")["medium"].max_tokens,
        context_tokens=chat_limits.current(db).context_tokens,
        rate_limit_per_minute=settings.chat_rate_limit_per_minute,
        prompt_cache=settings.chat_prompt_cache,
        cache_ttl=settings.cache_ttl,
        exchange_rate=_rate_read(db, current) if current else None,
        rate_history=[_rate_read(db, row) for row in pricing.rate_history(db)],
        fx=_fx_read(db, settings),
        chat_limits=_limits_read(db),
    )


@router.get("", response_model=ClaudeSettingsRead, summary="The rate, the default model and the chat limits")
def read_claude_pricing(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ClaudeSettingsRead:
    return _settings_read(db, settings)


@router.post(
    "/exchange-rate",
    response_model=ClaudeSettingsRead,
    summary="Set the won-per-dollar rate (a new row; history is kept)",
)
def set_exchange_rate(
    payload: ExchangeRateWrite,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ClaudeSettingsRead:
    previous = pricing.current_rate(db)
    db.add(ExchangeRate(currency="USD", krw_per_unit=payload.krw_per_usd, set_by=admin.id, source="admin"))
    # owner-polish-3 (b): a rate typed in is a pin — the daily refresh
    # must not overwrite it tomorrow. The switch turns it back on.
    was_auto = fx.status_row(db).auto_enabled
    fx.pin_by_hand(db, admin=admin)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.EXCHANGE_RATE_SET,
        target_type="exchange_rate",
        target_label="USD",
        summary=(
            f"환율: 1달러 = {payload.krw_per_usd:,}원"
            + (f" (이전 {previous.krw_per_unit:,}원)" if previous else "")
            + (" · 자동 반영 꺼짐 (고정)" if was_auto else "")
        ),
        detail={
            "before": str(previous.krw_per_unit) if previous else None,
            "after": str(payload.krw_per_usd),
            "auto_enabled": False,
        },
    )
    db.commit()
    return _settings_read(db, settings)


@router.post(
    "/exchange-rate/auto",
    response_model=ClaudeSettingsRead,
    summary="owner-polish-3: turn the daily automatic rate on (or pin the current rate: off)",
)
def set_exchange_rate_auto(
    payload: FxAutoWrite,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ClaudeSettingsRead:
    fx.set_auto(db, admin=admin, on=payload.on)
    db.commit()
    return _settings_read(db, settings)


@router.post(
    "/exchange-rate/refresh",
    response_model=ClaudeSettingsRead,
    summary="owner-polish-3: fetch today's rate now (the same rules as the daily job)",
)
def refresh_exchange_rate(
    payload: EmptyBody,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ClaudeSettingsRead:
    """Applied, unchanged, held back (over 5%) or failed — the status row
    says which; a failure keeps the last rate and is not an error here."""
    result = fx.refresh(db, settings)
    if result.outcome == "paused":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=result.message)
    db.commit()
    return _settings_read(db, settings)


@router.post(
    "/chat-limits",
    response_model=ClaudeSettingsRead,
    summary="Set the chat limits (a new row; history is kept)",
)
def set_chat_limits(
    payload: ChatLimitsWrite,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ClaudeSettingsRead:
    """token-guard: per-reply cap, warning threshold, daily cap. Audited.

    A new row per change, like the exchange rate, so the history is the
    table itself. 0 switches that guard off.
    """
    before = chat_limits.current(db)
    try:
        levels = depth_service.checked_table(
            payload.depth_levels if payload.depth_levels is not None else depth_service.full_table(before.depth_levels)
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    db.add(
        ChatLimits(
            reply_cap_krw=payload.reply_cap_krw,
            long_history_tokens=payload.long_history_tokens,
            daily_cap_krw=payload.daily_cap_krw,
            provider_concurrency=payload.provider_concurrency,
            web_fetch_max_uses=payload.web_fetch_max_uses,
            web_fetch_max_content_tokens=payload.web_fetch_max_content_tokens,
            web_search_max_uses=payload.web_search_max_uses,
            app_ai_daily_cap_krw=payload.app_ai_daily_cap_krw,
            depth_levels=levels,
            context_tokens=payload.context_tokens,
            timeout_seconds=payload.timeout_seconds,
            set_by=admin.id,
        )
    )

    def won(value: int) -> str:
        return f"{value:,}원" if value > 0 else "끔"

    head = (
        f"답장 1회 한도 {won(payload.reply_cap_krw)} · "
        f"긴 대화 경고 {payload.long_history_tokens:,} 토큰 · "
        f"하루 한도 {won(payload.daily_cap_krw)} · "
        f"동시 호출 {payload.provider_concurrency} · "
        f"페이지 읽기 {payload.web_fetch_max_uses}회×"
        f"{payload.web_fetch_max_content_tokens:,}토큰 · "
        f"웹 검색 {payload.web_search_max_uses}회 · "
        f"앱 AI 하루 한도 {won(payload.app_ai_daily_cap_krw)} · "
        f"대화 기억 {payload.context_tokens:,}토큰 · 응답 대기 {payload.timeout_seconds}초 · "
    )
    summary = head + f"생각 깊이 {depth_service.summary(levels)}"
    if len(summary) > 300:
        # The summary column is 300 characters; the full table is in `detail`.
        summary = head + "생각 깊이 표 변경 (상세 참고)"
    audit.record(
        db,
        actor=admin,
        action=AuditAction.CHAT_LIMITS_SET,
        target_type="chat_limits",
        target_label="채팅 한도",
        summary=summary,
        detail={
            "before": {
                "reply_cap_krw": before.reply_cap_krw,
                "long_history_tokens": before.long_history_tokens,
                "daily_cap_krw": before.daily_cap_krw,
                "provider_concurrency": before.provider_concurrency,
                "web_fetch_max_uses": before.web_fetch_max_uses,
                "web_fetch_max_content_tokens": before.web_fetch_max_content_tokens,
                "web_search_max_uses": before.web_search_max_uses,
                "app_ai_daily_cap_krw": before.app_ai_daily_cap_krw,
                "depth_levels": depth_service.full_table(before.depth_levels),
                "context_tokens": before.context_tokens,
                "timeout_seconds": before.timeout_seconds,
            },
            "after": payload.model_dump(),
        },
    )
    db.commit()
    return _settings_read(db, settings)


# ---------------------------------------------- 빌더 점검 (quality-tuning Q2)


class BuilderEvalRead(BaseModel):
    id: int
    created_at: datetime
    provider: str
    ideas: int
    succeeded: int
    total_krw: int
    run_by_username: str
    markdown: str


@router.get(
    "/builder-eval",
    response_model=list[BuilderEvalRead],
    summary="빌더 점검 reports, newest first (written by app.tools.builder_eval)",
)
def read_builder_evals(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[BuilderEvalRead]:
    rows = db.scalars(select(BuilderEvalReport).order_by(BuilderEvalReport.id.desc()).limit(10))
    out = []
    for row in rows:
        who = db.get(User, row.run_by) if row.run_by else None
        out.append(
            BuilderEvalRead(
                id=row.id,
                created_at=row.created_at,
                provider=row.provider,
                ideas=row.ideas,
                succeeded=row.succeeded,
                total_krw=row.total_krw,
                run_by_username=who.username if who else "",
                markdown=row.markdown,
            )
        )
    return out

