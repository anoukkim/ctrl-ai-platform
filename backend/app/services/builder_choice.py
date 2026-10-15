"""Which model and 생각 깊이 a Builder call runs at (quality-tuning Q1).

The Builder's panel has the same picker as Chat. The choice is remembered
on the project (`BuilderProject.chat_model_id` / `depth`); a new project
starts from the member's default (Profile › 기본 모델). Every number comes
from the server: the depth's `builder` row in `chat_limits.depth_levels`
gives the effort, the room (`max_tokens`) and the per-call cap, and the cap
is enforced before the call as a smaller room — the same way Chat's
token-guard does it.

A remembered model the member may no longer use falls back to the
catalogue default rather than refusing: a project must stay editable.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderProject, ChatModel, ChatModelVisibility, User
from app.services import chat_limits, chat_models, pricing
from app.services import depth as depth_service

#: The least room a generation is worth starting with: below it no whole
#: file fits, and the call would be paid for nothing.
MIN_ROOM_TOKENS = 2_048


@dataclass(frozen=True)
class BuildChoice:
    model: chat_models.ChosenModel
    price: pricing.Price
    level: depth_service.Level
    #: None: the model has no effort (Haiku) — none is sent.
    effort: str | None

    @property
    def depth(self) -> str | None:
        """What the receipt and the usage event show."""
        return self.level.name if self.effort else None

    def room(self, input_tokens: int) -> int:
        """The most this call may write: the depth's room, or less when the
        per-call cap would be passed. Under `MIN_ROOM_TOKENS` the caller
        refuses — free."""
        room = self.level.max_tokens
        if self.level.cap_krw > 0:
            room = min(room, chat_limits.output_budget(self.price, self.level.cap_krw, input_tokens))
        return room


def _usable(db: Session, user: User, chat_model_id: int | None) -> ChatModel | None:
    if chat_model_id is None:
        return None
    row = db.get(ChatModel, chat_model_id)
    if row is None or not chat_models.may_use(row, user):
        return None
    return row


def choose(
    db: Session, settings: Settings, user: User, project: BuilderProject | None = None
) -> BuildChoice:
    """The project's model and depth, else the member's defaults, else the
    catalogue default at 보통."""
    row = _usable(db, user, project.chat_model_id if project is not None else None)
    if row is None:
        row = _usable(db, user, user.default_chat_model_id)
    model = chat_models.ChosenModel.of(row) if row is not None else chat_models.default_model(db, settings)
    wanted = (project.depth if project is not None else None) or user.default_depth
    level, effort = depth_service.resolve(
        chat_limits.current(db).depth_levels, "builder", model.model_id, wanted
    )
    return BuildChoice(model=model, price=pricing.price_for(db, model), level=level, effort=effort)


def room_refusal(choice: BuildChoice) -> str:
    return (
        f"프로젝트가 커서 {depth_service.LABELS[choice.level.name]} 깊이의 1회 한도"
        f"({choice.level.cap_krw:,}원)로는 파일을 쓸 수 없어요. 생각 깊이를 높여 주세요."
    )


def options(
    db: Session, user: User, input_tokens: int, typical_output_tokens: int, default_id: int | None
) -> list[dict]:
    """The picker's models for a Builder call: label, description, "1회 약
    N원" at 보통, and each depth's estimate and cap."""
    rate = pricing.current_rate(db)
    stored = chat_limits.current(db).depth_levels
    out = []
    for row in chat_models.models_for(db, user):
        chosen = chat_models.ChosenModel.of(row)
        estimate = None
        price = None
        if rate is not None and chat_models.provider_info(row.provider).ready:
            try:
                price = pricing.price_for(db, chosen)
                estimate = price.krw(input_tokens, typical_output_tokens)
            except pricing.PricingError:
                price = estimate = None
        levels = depth_service.options(stored, "builder", row.model_id, estimate)
        if price is not None:
            # "(최대 M원)" is what the pre-check reserves for this project:
            # the depth's cap, or less when its room costs less than that.
            table = depth_service.table(stored, "builder")
            for step in levels:
                choice = BuildChoice(model=chosen, price=price, level=table[step["level"]], effort=step["level"])
                step["max_krw"] = min(step["max_krw"], price.krw(input_tokens, max(choice.room(input_tokens), 0)))
                if step["estimate_krw"] is not None:
                    step["estimate_krw"] = min(step["estimate_krw"], step["max_krw"])
        out.append(
            {
                "id": row.id,
                "model_id": row.model_id,
                "label": row.label,
                "description": row.description,
                "admin_only": row.visibility is ChatModelVisibility.ADMIN,
                "is_default": row.id == default_id,
                "estimated_krw": estimate,
                "levels": levels,
                "flat_max_krw": depth_service.table(stored, "builder")[depth_service.DEFAULT_LEVEL].cap_krw,
                "depth_note": depth_service.note_for(row.model_id),
            }
        )
    return out
