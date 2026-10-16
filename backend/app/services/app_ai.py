"""CTRL+AI 기능 상자 — `ctrlai.ai` (app-platform P2).

AI inside a member app is paid by the **visitor**, from their own 동아리
지원 wallet (CLAUDE.md §2, "Member app platform"), through
`usage.charge()` with feature `app_ai` and the app's project id. Every
guard runs **before** the provider is called, and nothing is charged for
a refusal:

* the visitor is signed in to this app, allowed "ai", and an active
  member this quarter;
* the app's 기능 상자 is not stopped by an admin;
* models: "fast" / "smart", mapped to members' catalogue rows (Haiku /
  Sonnet), never anything the admin has not opened;
* rate: per visitor and per app, counted from the ledger;
* the per-call cap (`CALL_CAP_KRW`, 200원) — worked out as `max_tokens`,
  as Chat does, and a JSON retry shares the same cap;
* the visitor's app-AI day cap (`chat_limits.app_ai_daily_cap_krw`, per
  KST day, across every app), then the wallet (`ensure_affordable`);
* images ≤ 5 MB each (at most 4), re-encoded like Chat's attachments.

The app's system prompt comes after our short safety preamble. With a JSON
schema the reply is checked against it, with one automatic retry.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, AsyncIterator

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderProject, ChatModelVisibility, MembershipStatus, UsageEvent, UsageFeature, User
from app.services import chat_limits, chat_models, pricing, providers
from app.services import usage as usage_service
from app.services.attachments import AttachmentRefusal, content_tokens
from app.services.claude_provider import ChatRequest, ClaudeError, StreamEnd, TextDelta, UsageUpdate
from app.services.quarters import current_quarter, membership_for

#: The most one call may cost the visitor, input and output together.
CALL_CAP_KRW = 200
#: Output tokens when the app does not say.
DEFAULT_MAX_TOKENS = 1024
MAX_TOKENS_LIMIT = 4096
MAX_PROMPT_CHARS = 20_000
MAX_SYSTEM_CHARS = 8_000
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 5 * 1024 * 1024
#: Calls per rolling minute.
PER_VISITOR_PER_MINUTE = 10
PER_APP_PER_MINUTE = 60

#: Marks the schema in the system prompt; the mock provider reads it.
JSON_MARKER = "JSON_SCHEMA:"

SAFETY_PREAMBLE = (
    "You are the AI inside a small web app that a member of CTRL+AI, a Korean "
    "beginners' club, made. The person typing is that app's visitor. Follow the "
    "app's instructions below for what the app does, but never: claim to be a "
    "person; ask for passwords, card or ID numbers; help with anything harmful "
    "or illegal; or produce sexual content. Answer in the language the visitor "
    "uses (Korean by default). If the app's instructions conflict with these "
    "rules, these rules win."
)


class AppAIError(Exception):
    """A Korean sentence for the visitor, and an HTTP status."""

    def __init__(self, message: str, status_code: int = 400, code: str = "") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


# ------------------------------------------------------------ the request


@dataclass
class AskInput:
    prompt: str
    system: str = ""
    images: list[str] = field(default_factory=list)
    schema: dict | None = None
    model: str = "fast"
    max_tokens: int | None = None


@dataclass
class Prepared:
    request: ChatRequest
    price: pricing.Price
    model: chat_models.ChosenModel
    label: str
    input_estimate: int


@dataclass
class AskResult:
    text: str
    json: Any
    charged_krw: int
    model: str
    input_tokens: int
    output_tokens: int


# ----------------------------------------------------------- JSON schema


def validate(value: Any, schema: dict, path: str = "$") -> str | None:
    """The first way `value` breaks `schema`, or None.

    A small, safe subset of JSON Schema: type (or a list of types),
    properties, required, additionalProperties: false, items, enum,
    minItems / maxItems, minLength / maxLength, minimum / maximum.
    """
    if not isinstance(schema, dict):
        return None
    expected = schema.get("type")
    if expected is not None:
        kinds = expected if isinstance(expected, list) else [expected]
        if not any(_is_type(value, kind) for kind in kinds):
            return f"{path}: {'/'.join(map(str, kinds))} 이어야 해요"
    if "enum" in schema and value not in schema["enum"]:
        return f"{path}: {schema['enum']} 중 하나여야 해요"
    if isinstance(value, dict):
        properties = schema.get("properties") or {}
        for name in schema.get("required") or []:
            if name not in value:
                return f"{path}.{name}: 빠졌어요"
        if schema.get("additionalProperties") is False:
            extra = [key for key in value if key not in properties]
            if extra:
                return f"{path}.{extra[0]}: 정의되지 않은 항목이에요"
        for name, sub in properties.items():
            if name in value:
                problem = validate(value[name], sub, f"{path}.{name}")
                if problem:
                    return problem
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            return f"{path}: 항목이 {schema['minItems']}개 이상이어야 해요"
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            return f"{path}: 항목이 {schema['maxItems']}개 이하여야 해요"
        if isinstance(schema.get("items"), dict):
            for index, item in enumerate(value):
                problem = validate(item, schema["items"], f"{path}[{index}]")
                if problem:
                    return problem
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            return f"{path}: {schema['minLength']}자 이상이어야 해요"
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            return f"{path}: {schema['maxLength']}자 이하여야 해요"
    if _is_type(value, "number"):
        if "minimum" in schema and value < schema["minimum"]:
            return f"{path}: {schema['minimum']} 이상이어야 해요"
        if "maximum" in schema and value > schema["maximum"]:
            return f"{path}: {schema['maximum']} 이하여야 해요"
    return None


def _is_type(value: Any, kind: str) -> bool:
    if kind == "object":
        return isinstance(value, dict)
    if kind == "array":
        return isinstance(value, list)
    if kind == "string":
        return isinstance(value, str)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if kind == "null":
        return value is None
    return True


def parse_json(text: str) -> Any:
    """The reply as JSON — allowing a ```json fence around it."""
    stripped = text.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", stripped, re.DOTALL)
    if fenced:
        stripped = fenced.group(1)
    return json.loads(stripped)


def sample_for(schema: Any) -> Any:
    """A value that fits `schema` — what the mock provider answers."""
    if not isinstance(schema, dict):
        return "예시"
    if schema.get("enum"):
        return schema["enum"][0]
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next((k for k in kind if k != "null"), kind[0] if kind else "string")
    if kind == "object" or (kind is None and "properties" in schema):
        return {name: sample_for(sub) for name, sub in (schema.get("properties") or {}).items()}
    if kind == "array":
        count = max(1, int(schema.get("minItems", 1)))
        return [sample_for(schema.get("items") or {}) for _ in range(count)]
    if kind == "integer":
        return int(schema.get("minimum", 1))
    if kind == "number":
        return schema.get("minimum", 1)
    if kind == "boolean":
        return True
    if kind == "null":
        return None
    return "예시"


# --------------------------------------------------------------- checks


#: Both count toward the rates and the day cap: a maker trying their app
#: in the 미리보기 spends the same wallet (app-platform P4).
APP_AI_FEATURES = (UsageFeature.APP_AI.value, UsageFeature.APP_AI_PREVIEW.value)


def ensure_member(db: Session, user: User) -> None:
    """The visitor must be taking part this quarter (`require_active_member`)."""
    quarter = current_quarter(db)
    membership = membership_for(db, user.id, quarter.id) if quarter else None
    if quarter is None or membership is None or membership.status is not MembershipStatus.ACTIVE:
        raise AppAIError(
            "이번 분기에 참여 중인 CTRL+AI 회원만 이 앱에서 AI를 쓸 수 있어요.", 403, "not_participating"
        )


def _recent_calls(db: Session, **where: int) -> int:
    since = datetime.now(timezone.utc) - timedelta(minutes=1)
    query = select(func.count(UsageEvent.id)).where(
        UsageEvent.feature.in_(APP_AI_FEATURES), UsageEvent.created_at >= since
    )
    if "user_id" in where:
        query = query.where(UsageEvent.user_id == where["user_id"])
    if "project_id" in where:
        query = query.where(UsageEvent.builder_project_id == where["project_id"])
    return int(db.scalar(query) or 0)


def check_rate(db: Session, user: User, project: BuilderProject) -> None:
    if _recent_calls(db, user_id=user.id) >= PER_VISITOR_PER_MINUTE:
        raise AppAIError(
            f"AI를 너무 자주 부르고 있어요. 1분에 {PER_VISITOR_PER_MINUTE}번까지예요. 잠시 후 다시 해 주세요.",
            429,
            "rate",
        )
    if _recent_calls(db, project_id=project.id) >= PER_APP_PER_MINUTE:
        raise AppAIError("이 앱에 지금 사람이 많아요. 잠시 후 다시 해 주세요.", 429, "rate")


def app_ai_spent_today(db: Session, user_id: int) -> int:
    spent = db.scalar(
        select(func.coalesce(func.sum(UsageEvent.charged_krw), 0)).where(
            UsageEvent.user_id == user_id,
            UsageEvent.feature.in_(APP_AI_FEATURES),
            UsageEvent.created_at >= chat_limits.kst_day_start(),
        )
    )
    return int(spent or 0)


def check_day_cap(db: Session, user: User, worst_case: int) -> None:
    cap = chat_limits.current(db).app_ai_daily_cap_krw
    if cap <= 0:
        return
    spent = app_ai_spent_today(db, user.id)
    if spent + worst_case > cap:
        raise AppAIError(
            f"앱에서 오늘 쓸 수 있는 AI 금액({cap:,}원)을 넘어요. 오늘 {spent:,}원을 썼어요. 내일 다시 써 주세요.",
            402,
            "day_cap",
        )


def choose_model(db: Session, settings: Settings, name: str) -> tuple[chat_models.ChosenModel, str]:
    """"fast" → a members' Haiku row, "smart" → a members' Sonnet row."""
    if name not in ("fast", "smart"):
        raise AppAIError('model은 "fast" 또는 "smart"만 쓸 수 있어요.')
    family = "haiku" if name == "fast" else "sonnet"
    rows = [
        row
        for row in chat_models.all_models(db)
        if row.visibility is ChatModelVisibility.MEMBERS and family in row.model_id.lower()
    ]
    chosen = chat_models.ChosenModel.of(rows[0]) if rows else chat_models.default_model(db, settings)
    chat_models.require_adapter(chosen)
    return chosen, name


def images_of(data_urls: list[str], settings: Settings) -> list[tuple[dict, int]]:
    """Each image as a content block (re-encoded, EXIF dropped) and its token estimate."""
    from app.services import attachments

    if len(data_urls) > MAX_IMAGES:
        raise AppAIError(f"이미지는 한 번에 {MAX_IMAGES}장까지 보낼 수 있어요.")
    blocks: list[tuple[dict, int]] = []
    for url in data_urls:
        match = re.match(r"^data:image/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$", url or "")
        if not match:
            raise AppAIError("이미지는 PNG · JPEG · WebP · GIF의 data URL로 보내 주세요.")
        try:
            raw = base64.b64decode(match.group(2), validate=False)
        except (binascii.Error, ValueError) as error:
            raise AppAIError("이미지를 읽지 못했어요.") from error
        if len(raw) > MAX_IMAGE_BYTES:
            raise AppAIError("이미지 하나는 5MB까지예요.", 413)
        try:
            checked = attachments._image(raw, settings)  # noqa: SLF001 — Chat's own re-encoder
        except AttachmentRefusal as error:
            raise AppAIError(str(error)) from error
        block = {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": checked.media_type,
                "data": base64.b64encode(checked.data).decode("ascii"),
            },
        }
        blocks.append((block, checked.estimated_tokens))
    return blocks


def system_prompt(app_system: str, schema: dict | None) -> str:
    parts = [SAFETY_PREAMBLE]
    if app_system.strip():
        parts.append("App instructions:\n" + app_system.strip())
    if schema is not None:
        parts.append(
            "Reply with ONLY a JSON value (no prose, no code fence) that matches this JSON Schema.\n"
            f"{JSON_MARKER}\n{json.dumps(schema, ensure_ascii=False)}"
        )
    return "\n\n".join(parts)


def prepare(
    db: Session,
    settings: Settings,
    *,
    user: User,
    project: BuilderProject,
    data: AskInput,
    spent_krw: int = 0,
    messages: list[dict] | None = None,
) -> Prepared:
    """Every check that can refuse, and the request. Spends nothing.

    `spent_krw` is what earlier attempts of the same call already cost (a
    JSON retry): they share the one per-call cap.
    """
    if project.sdk_disabled_at is not None:
        raise AppAIError("이 앱의 기능 상자는 관리자가 잠시 멈췄어요.", 403, "sdk_off")
    prompt = (data.prompt or "").strip()
    if not prompt and not data.images:
        raise AppAIError("prompt를 적어 주세요.")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise AppAIError(f"prompt는 {MAX_PROMPT_CHARS:,}자까지예요.")
    if len(data.system or "") > MAX_SYSTEM_CHARS:
        raise AppAIError(f"system은 {MAX_SYSTEM_CHARS:,}자까지예요.")
    ensure_member(db, user)
    if spent_krw == 0:
        check_rate(db, user, project)
    try:
        model, label = choose_model(db, settings, data.model or "fast")
        price = pricing.price_for(db, model)
    except chat_models.ModelChoiceError as error:
        raise AppAIError(str(error), error.status_code, "model") from error
    except pricing.PricingError as error:
        raise AppAIError(str(error), 503, "pricing") from error

    if messages is None:
        image_blocks = images_of(data.images, settings)
        content: str | list[dict]
        if image_blocks:
            content = [block for block, _ in image_blocks] + [{"type": "text", "text": prompt or "이 이미지를 봐 줘."}]
        else:
            content = prompt
        messages = [{"role": "user", "content": content}]
    system = system_prompt(data.system or "", data.schema)
    input_estimate = content_tokens(system) + sum(content_tokens(m["content"]) for m in messages)

    cap_left = CALL_CAP_KRW - spent_krw
    budget = chat_limits.output_budget(price, cap_left, input_estimate)
    if budget < 1:
        if spent_krw:
            raise AppAIError("AI 답이 JSON 형식에 맞지 않았고, 다시 물어볼 비용이 남지 않았어요.", 502, "bad_json")
        raise AppAIError(f"입력이 너무 길어 1회 비용 한도({CALL_CAP_KRW}원)에 닿아요. 줄여서 다시 보내 주세요.")
    wanted = min(max(1, int(data.max_tokens or DEFAULT_MAX_TOKENS)), MAX_TOKENS_LIMIT)
    max_tokens = min(wanted, budget)
    worst_case = price.worst_case_krw(input_estimate, max_tokens)
    if spent_krw == 0:
        check_day_cap(db, user, worst_case)
    try:
        usage_service.ensure_affordable(db, user=user, amount_krw=worst_case, settings=settings)
    except usage_service.InsufficientBudgetError as error:
        raise AppAIError(str(error), 402, "wallet") from error
    except usage_service.NoQuarterError as error:
        raise AppAIError(str(error), 409, "no_quarter") from error

    return Prepared(
        request=ChatRequest(system=system, messages=messages, max_tokens=max_tokens, model=model.model_id),
        price=price,
        model=model,
        label=label,
        input_estimate=input_estimate,
    )


# ----------------------------------------------------------------- the call


@dataclass
class Tally:
    text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    stop_reason: str = ""


async def run(provider: Any, prepared: Prepared) -> AsyncIterator[tuple[str, Any]]:
    """Stream one provider call: ("delta", text)… then ("done", Tally)."""
    tally = Tally()
    last_usage: UsageUpdate | None = None
    async for event in provider.stream_chat(prepared.request):
        if isinstance(event, TextDelta):
            tally.text += event.text
            yield "delta", event.text
        elif isinstance(event, UsageUpdate):
            last_usage = event
        elif isinstance(event, StreamEnd):
            tally.stop_reason = event.stop_reason
    if last_usage is not None:
        tally.input_tokens = last_usage.input_tokens + last_usage.cache_write_tokens + last_usage.cache_read_tokens
        tally.output_tokens = last_usage.output_tokens
    yield "done", tally


def charge(
    db: Session,
    settings: Settings,
    *,
    user: User,
    project: BuilderProject,
    prepared: Prepared,
    input_tokens: int,
    output_tokens: int,
    is_mock: bool,
    preview: bool = False,
) -> int:
    """One ledger row for the whole call (a JSON retry included). `preview`:
    the Builder's 미리보기 — the maker's own try, labelled apart."""
    price = prepared.price
    amount = price.krw(input_tokens, output_tokens)
    result = usage_service.charge(
        db,
        user=user,
        amount_krw=amount,
        provider="claude",
        feature=(UsageFeature.APP_AI_PREVIEW if preview else UsageFeature.APP_AI).value,
        model_id=prepared.model.model_id,
        provider_units=input_tokens + output_tokens,
        provider_unit="tokens",
        provider_cost=price.usd(input_tokens, output_tokens).quantize(Decimal("0.000001")),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        exchange_rate_krw=price.usd_krw,
        cost=price.split(input_tokens, output_tokens),
        builder_project_id=project.id,
        commit=False,
        cap_to_available=True,
        settings=settings,
    )
    providers.record_success(db, "claude", "앱 AI" + (" (mock)" if is_mock else ""))
    db.commit()
    return result.event.charged_krw


def record_failure(db: Session, error: ClaudeError) -> None:
    providers.record_failure(db, "claude", error.kind, error.detail)
    db.commit()


async def ask(
    db: Session,
    settings: Settings,
    provider: Any,
    *,
    user: User,
    project: BuilderProject,
    data: AskInput,
    is_mock: bool,
    preview: bool = False,
) -> AskResult:
    """`ctrlai.ai.ask`: one answer, as text — or JSON checked against the
    schema, with one automatic retry inside the same per-call cap."""
    prepared = prepare(db, settings, user=user, project=project, data=data)
    first_prepared = prepared
    total_in = total_out = 0
    messages = prepared.request.messages
    attempt = 0
    while True:
        attempt += 1
        tally: Tally | None = None
        try:
            async for kind, value in run(provider, prepared):
                if kind == "done":
                    tally = value
        except ClaudeError as error:
            if total_in or total_out:
                charge(db, settings, user=user, project=project, prepared=first_prepared,
                       input_tokens=total_in, output_tokens=total_out, is_mock=is_mock, preview=preview)
            record_failure(db, error)
            raise AppAIError(str(error), 503, "provider") from error
        assert tally is not None
        total_in += tally.input_tokens
        total_out += tally.output_tokens
        if data.schema is None:
            break
        problem: str | None
        try:
            parsed = parse_json(tally.text)
            problem = validate(parsed, data.schema)
        except ValueError:
            parsed, problem = None, "JSON으로 읽을 수 없어요"
        if problem is None:
            break
        if attempt >= 2:
            charged = charge(db, settings, user=user, project=project, prepared=first_prepared,
                             input_tokens=total_in, output_tokens=total_out, is_mock=is_mock, preview=preview)
            raise AppAIError(
                f"AI 답이 정해 준 JSON 형식에 맞지 않았어요({problem}). {charged}원이 쓰였어요.",
                502,
                "bad_json",
            )
        spent = first_prepared.price.krw(total_in, total_out)
        messages = [
            *messages,
            {"role": "assistant", "content": tally.text or "(빈 답)"},
            {
                "role": "user",
                "content": f"That reply did not match the schema ({problem}). Reply again with ONLY the JSON value.",
            },
        ]
        try:
            prepared = prepare(db, settings, user=user, project=project, data=data, spent_krw=spent, messages=messages)
        except AppAIError:
            charge(db, settings, user=user, project=project, prepared=first_prepared,
                   input_tokens=total_in, output_tokens=total_out, is_mock=is_mock, preview=preview)
            raise

    charged = charge(db, settings, user=user, project=project, prepared=first_prepared,
                     input_tokens=total_in, output_tokens=total_out, is_mock=is_mock, preview=preview)
    return AskResult(
        text=tally.text,
        json=parsed if data.schema is not None else None,
        charged_krw=charged,
        model=prepared.label,
        input_tokens=total_in,
        output_tokens=total_out,
    )
