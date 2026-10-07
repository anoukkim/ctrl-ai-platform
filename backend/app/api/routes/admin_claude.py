"""Admin › System — what Claude costs.

Two figures decide what every Chat reply and prompt-helper call costs a
member: the per-model token price and the won-per-dollar rate. Both are
edited here rather than in code, and both changes are written to the
audit log, because they move what every later call is charged.

Admin-only, and — like every other Admin screen — not gated on
participation: setting prices is administration, not creation.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AuditAction, ClaudeModelPrice, ExchangeRate, User
from app.schemas.pricing import (
    ClaudeModelPriceRead,
    ClaudeModelPriceWrite,
    ClaudeSettingsRead,
    ExchangeRateRead,
    ExchangeRateWrite,
)
from app.services import audit, pricing

router = APIRouter(prefix="/admin/claude-pricing", tags=["admin"])

#: An Anthropic model id: lower-case letters, digits, dots and dashes.
MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9.\-]{1,119}$")


def _rate_read(db: Session, row: ExchangeRate) -> ExchangeRateRead:
    who = db.get(User, row.set_by) if row.set_by else None
    return ExchangeRateRead(
        krw_per_usd=row.krw_per_unit,
        set_at=row.created_at,
        set_by_username=who.username if who else "",
    )


def _settings_read(db: Session, settings: Settings) -> ClaudeSettingsRead:
    current = pricing.current_rate(db)
    return ClaudeSettingsRead(
        is_mock=settings.provider_is_mock("claude"),
        model=settings.anthropic_model.strip(),
        priced_as=pricing.priced_model(
            "mock" if settings.provider_is_mock("claude") else settings.anthropic_model.strip(),
            settings,
        ),
        thinking=settings.chat_thinking,
        effort=settings.chat_effort,
        max_output_tokens=settings.chat_max_output_tokens,
        context_tokens=settings.chat_context_tokens,
        rate_limit_per_minute=settings.chat_rate_limit_per_minute,
        prices=[ClaudeModelPriceRead.model_validate(row) for row in pricing.all_prices(db)],
        exchange_rate=_rate_read(db, current) if current else None,
        rate_history=[_rate_read(db, row) for row in pricing.rate_history(db)],
    )


@router.get("", response_model=ClaudeSettingsRead, summary="Claude prices, rate and limits")
def read_claude_pricing(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ClaudeSettingsRead:
    return _settings_read(db, settings)


@router.put(
    "/models/{model_id}",
    response_model=ClaudeSettingsRead,
    summary="Set one model's token prices (adds the model if it is new)",
)
def put_model_price(
    model_id: str,
    payload: ClaudeModelPriceWrite,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ClaudeSettingsRead:
    if not MODEL_ID.match(model_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="모델 ID는 영문 소문자, 숫자, 점(.)과 대시(-)만 쓸 수 있습니다.",
        )

    row = db.get(ClaudeModelPrice, model_id)
    before = (
        {
            "input_usd_per_mtok": str(row.input_usd_per_mtok),
            "output_usd_per_mtok": str(row.output_usd_per_mtok),
        }
        if row
        else None
    )
    if row is None:
        row = ClaudeModelPrice(model_id=model_id)
        db.add(row)
    row.display_name = payload.display_name.strip() or row.display_name or model_id
    row.input_usd_per_mtok = payload.input_usd_per_mtok
    row.output_usd_per_mtok = payload.output_usd_per_mtok

    after = {
        "input_usd_per_mtok": str(payload.input_usd_per_mtok),
        "output_usd_per_mtok": str(payload.output_usd_per_mtok),
    }
    audit.record(
        db,
        actor=admin,
        action=AuditAction.CLAUDE_PRICE_UPDATED,
        target_type="claude_model",
        target_label=model_id,
        summary=(
            f"{model_id} 요금: 입력 ${payload.input_usd_per_mtok} · "
            f"출력 ${payload.output_usd_per_mtok} (100만 토큰당)"
        ),
        detail={"before": before, "after": after},
    )
    db.commit()
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
    db.add(ExchangeRate(currency="USD", krw_per_unit=payload.krw_per_usd, set_by=admin.id))
    audit.record(
        db,
        actor=admin,
        action=AuditAction.EXCHANGE_RATE_SET,
        target_type="exchange_rate",
        target_label="USD",
        summary=(
            f"환율: 1달러 = {payload.krw_per_usd:,}원"
            + (f" (이전 {previous.krw_per_unit:,}원)" if previous else "")
        ),
        detail={
            "before": str(previous.krw_per_unit) if previous else None,
            "after": str(payload.krw_per_usd),
        },
    )
    db.commit()
    return _settings_read(db, settings)
