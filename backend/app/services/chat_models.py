"""The chat model catalogue: which model a reply uses, and who may pick it.

The catalogue lives in the database (`ChatModel`), seeded by the migration
and edited in Admin › Claude Models. Three rules, all enforced here rather
than in the browser:

* **Who may pick what.** `members` models are open to everyone; `admin`
  models only to admins (to try a model before opening it up); `disabled`
  models to nobody. A request naming anything else is refused with a
  Korean sentence — the picker only shows what is allowed, but a browser
  can send anything.
* **Which model a reply uses.** The conversation's own choice, else the
  catalogue default. A choice that has since been closed is refused at
  send time rather than quietly swapped: the member picked it, and a
  reply from another model at another price would surprise them.
* **The fallback.** Only when the catalogue is *empty* does
  `ANTHROPIC_MODEL` decide, priced from the list prices below. With any
  row present, the setting decides nothing.

A provider other than `anthropic` would be a new adapter, picked where
the chat route and the prompt helper call `get_claude_provider` today
(after `require_adapter`), plus catalogue rows — nothing else here changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import ChatModel, ChatModelVisibility, Conversation, User, UserRole

#: The only provider with an adapter today.
ANTHROPIC = "anthropic"
KNOWN_PROVIDERS = (ANTHROPIC,)

#: The mock has no price of its own. With an empty catalogue and no
#: `ANTHROPIC_MODEL`, it is priced as this — the agreed default
#: (2026-10-07) — so the budget behaves locally as it will for real.
MOCK_PRICED_AS = "claude-sonnet-5-5"


@dataclass(frozen=True)
class CatalogueSeed:
    model_id: str
    label: str
    description: str
    input_usd_per_mtok: Decimal
    output_usd_per_mtok: Decimal
    visibility: ChatModelVisibility
    is_default: bool
    sort_order: int
    provider: str = ANTHROPIC


#: Anthropic's list prices on 2026-10-07, in dollars per million tokens.
#: The migration seeds the same rows; this copy serves the tests (which
#: build their schema without migrations) and prices the empty-catalogue
#: fallback.
DEFAULT_CATALOGUE: list[CatalogueSeed] = [
    CatalogueSeed(
        model_id="claude-haiku-4-5",
        label="빠른 답변 (Haiku 4.5)",
        description="가장 빠르고 저렴합니다. 짧은 질문이나 간단한 정리에 알맞습니다.",
        input_usd_per_mtok=Decimal("1"),
        output_usd_per_mtok=Decimal("5"),
        visibility=ChatModelVisibility.MEMBERS,
        is_default=False,
        sort_order=10,
    ),
    CatalogueSeed(
        model_id="claude-sonnet-5-5",
        label="균형 잡힌 답변 (Sonnet 5.5)",
        description="속도와 품질이 고르게 좋습니다. 대부분의 대화에 알맞습니다.",
        input_usd_per_mtok=Decimal("2"),
        output_usd_per_mtok=Decimal("10"),
        visibility=ChatModelVisibility.MEMBERS,
        is_default=True,
        sort_order=20,
    ),
    CatalogueSeed(
        model_id="claude-opus-5-5",
        label="깊이 있는 답변 (Opus 5.5)",
        description="가장 깊이 생각합니다. 어려운 설계나 긴 글에 알맞지만 가장 비쌉니다.",
        input_usd_per_mtok=Decimal("4"),
        output_usd_per_mtok=Decimal("20"),
        visibility=ChatModelVisibility.ADMIN,
        is_default=False,
        sort_order=30,
    ),
]

LIST_PRICES: dict[str, tuple[Decimal, Decimal]] = {
    seed.model_id: (seed.input_usd_per_mtok, seed.output_usd_per_mtok)
    for seed in DEFAULT_CATALOGUE
}


class ModelChoiceError(Exception):
    """A model this member may not use, or none at all. Korean message."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ChosenModel:
    """The model a call uses and the figures it is priced at.

    A catalogue row, or — only with an empty catalogue — the
    `ANTHROPIC_MODEL` fallback, which has no row (`row_id` None).
    """

    provider: str
    model_id: str
    label: str
    input_usd_per_mtok: Decimal
    output_usd_per_mtok: Decimal
    row_id: int | None = None

    @classmethod
    def of(cls, row: ChatModel) -> ChosenModel:
        return cls(
            provider=row.provider,
            model_id=row.model_id,
            label=row.label,
            input_usd_per_mtok=Decimal(row.input_usd_per_mtok),
            output_usd_per_mtok=Decimal(row.output_usd_per_mtok),
            row_id=row.id,
        )


def seed_defaults(db: Session) -> None:
    """Add the default rows when the catalogue is empty. Does not commit.

    Only into an *empty* catalogue: an admin who removed or changed a
    model must not see it come back.
    """
    if db.scalar(select(ChatModel.id).limit(1)) is not None:
        return
    for seed in DEFAULT_CATALOGUE:
        db.add(
            ChatModel(
                provider=seed.provider,
                model_id=seed.model_id,
                label=seed.label,
                description=seed.description,
                input_usd_per_mtok=seed.input_usd_per_mtok,
                output_usd_per_mtok=seed.output_usd_per_mtok,
                visibility=seed.visibility,
                is_default=seed.is_default,
                sort_order=seed.sort_order,
            )
        )
    db.flush()


def all_models(db: Session) -> list[ChatModel]:
    return list(db.scalars(select(ChatModel).order_by(ChatModel.sort_order, ChatModel.id)))


def may_use(row: ChatModel, user: User) -> bool:
    if row.visibility is ChatModelVisibility.MEMBERS:
        return True
    return row.visibility is ChatModelVisibility.ADMIN and user.role is UserRole.ADMIN


def models_for(db: Session, user: User) -> list[ChatModel]:
    """What this member's picker offers, in catalogue order."""
    return [row for row in all_models(db) if may_use(row, user)]


def default_row(db: Session) -> ChatModel | None:
    """The default model: the flagged row, else the first one open to members."""
    rows = all_models(db)
    flagged = next(
        (r for r in rows if r.is_default and r.visibility is ChatModelVisibility.MEMBERS), None
    )
    if flagged is not None:
        return flagged
    return next((r for r in rows if r.visibility is ChatModelVisibility.MEMBERS), None)


def fallback(settings: Settings) -> ChosenModel:
    """`ANTHROPIC_MODEL`, for an empty catalogue only. Priced at list price.

    A model with no list price here cannot be charged, so it cannot be
    used — `pricing.price_for` refuses it.
    """
    model_id = settings.anthropic_model.strip() or MOCK_PRICED_AS
    input_price, output_price = LIST_PRICES.get(model_id, (Decimal(0), Decimal(0)))
    return ChosenModel(
        provider=ANTHROPIC,
        model_id=model_id,
        label=model_id,
        input_usd_per_mtok=input_price,
        output_usd_per_mtok=output_price,
    )


def default_model(db: Session, settings: Settings) -> ChosenModel:
    """What a new conversation and the video prompt helper use."""
    row = default_row(db)
    if row is not None:
        return ChosenModel.of(row)
    if not all_models(db):
        return fallback(settings)
    raise ModelChoiceError(
        "지금 쓸 수 있는 Claude 모델이 없습니다. 관리자에게 알려 주세요.", status_code=503
    )


def checked_choice(db: Session, user: User, chat_model_id: int) -> ChatModel:
    """A model the member asked for, if they may use it. Korean 400 otherwise.

    The same message whether the model is admin-only, disabled or does
    not exist: a member has no reason to learn which of the three it is.
    """
    row = db.get(ChatModel, chat_model_id)
    if row is None or not may_use(row, user):
        raise ModelChoiceError("고를 수 없는 모델입니다. 목록에 있는 모델 중에서 골라 주세요.")
    return row


def for_conversation(
    db: Session, settings: Settings, user: User, conversation: Conversation
) -> ChosenModel:
    """The model this conversation's next reply uses, checked for this member."""
    if conversation.chat_model_id is None:
        return default_model(db, settings)
    row = db.get(ChatModel, conversation.chat_model_id)
    if row is None:
        return default_model(db, settings)
    if not may_use(row, user):
        raise ModelChoiceError(
            f"이 대화의 {row.label} 모델은 지금 쓸 수 없습니다. "
            "입력창 옆에서 다른 모델을 골라 주세요."
        )
    return ChosenModel.of(row)


def require_adapter(chosen: ChosenModel) -> None:
    """Refuse a row whose provider has no adapter yet. Before anything is spent."""
    if chosen.provider not in KNOWN_PROVIDERS:
        raise ModelChoiceError(
            f"{chosen.label} 모델은 아직 연결되지 않았습니다. 다른 모델을 골라 주세요."
        )
