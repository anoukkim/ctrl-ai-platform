"""Admin › System — the won-per-dollar rate and how Claude is called.

Two figures decide what every Chat reply and prompt-helper call costs a
member: the per-model token price and the won-per-dollar rate. The rate
is edited here; the prices live with the models in Admin › Claude Models
(`admin_chat_models.py`). Both changes are written to the audit log,
because they move what every later call is charged.

Admin-only, and — like every other Admin screen — not gated on
participation: setting prices is administration, not creation.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import AuditAction, ExchangeRate, User
from app.schemas.pricing import (
    ClaudeSettingsRead,
    ExchangeRateRead,
    ExchangeRateWrite,
)
from app.services import audit, chat_models, pricing

router = APIRouter(prefix="/admin/claude-pricing", tags=["admin"])


def _rate_read(db: Session, row: ExchangeRate) -> ExchangeRateRead:
    who = db.get(User, row.set_by) if row.set_by else None
    return ExchangeRateRead(
        krw_per_usd=row.krw_per_unit,
        set_at=row.created_at,
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
        max_output_tokens=settings.chat_max_output_tokens,
        context_tokens=settings.chat_context_tokens,
        rate_limit_per_minute=settings.chat_rate_limit_per_minute,
        exchange_rate=_rate_read(db, current) if current else None,
        rate_history=[_rate_read(db, row) for row in pricing.rate_history(db)],
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
