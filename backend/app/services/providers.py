"""The provider layer's status board and connection check.

Four providers, each behind the `*_PROVIDER` setting with **mock as the
default** (CLAUDE.md section 20). This module does not generate anything
— the real Claude adapter is `app/services/claude_provider.py`, and
Higgsfield's arrives in Phase 6. What
it does is answer, for the Admin 시스템 screen:

* which implementation is selected, mock or real;
* whether a credential is configured — never what it is;
* when the provider last worked, and why it last failed;
* and, only when an admin presses the button, whether it works *now*.

**The check is never automatic.** A background poll against a paid API
spends money to produce a green dot nobody asked for. It runs on the
button press and at no other time.

**The check costs nothing.** In mock mode nothing leaves the process. For
Claude the real check lists models (`GET /v1/models`), which validates
the key without generating a single token. Where no such request exists
for a provider yet, the check says so rather than inventing one.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import PROVIDER_ERROR_LABEL, ProviderErrorKind, ProviderStatus

logger = logging.getLogger(__name__)

#: The four providers, in the order the screen shows them, with the name a
#: member of the club would recognise and what the provider is for.
PROVIDERS: list[dict[str, str]] = [
    {
        "key": "claude",
        "name": "Claude",
        "purpose": "대화, 글쓰기, 프로젝트 생성",
        "setting": "CLAUDE_PROVIDER",
        "real_mode": "anthropic",
        "phase": "Phase 2",
    },
    {
        "key": "video",
        "name": "Higgsfield",
        "purpose": "영상 생성",
        "setting": "VIDEO_PROVIDER",
        "real_mode": "higgsfield",
        "phase": "Phase 6",
    },
    {
        "key": "github",
        "name": "GitHub",
        "purpose": "회원 저장소 연결과 푸시",
        "setting": "GITHUB_PROVIDER",
        "real_mode": "github",
        "phase": "Phase 4",
    },
    {
        "key": "youtube",
        "name": "YouTube",
        "purpose": "영상 업로드와 채널 연결",
        "setting": "YOUTUBE_PROVIDER",
        "real_mode": "google",
        "phase": "Phase 7",
    },
]

PROVIDER_KEYS = [entry["key"] for entry in PROVIDERS]


@dataclass
class CheckResult:
    """What one press of 연결 확인 found."""

    ok: bool
    #: Korean, ready to show. The provider's own English text, if any,
    #: goes in `detail` instead.
    message: str
    error_kind: str = ""
    detail: str = ""


# --------------------------------------------------------------- 기록


def get_status(db: Session, provider: str) -> ProviderStatus | None:
    return db.get(ProviderStatus, provider)


def all_status(db: Session) -> dict[str, ProviderStatus]:
    return {row.provider: row for row in db.scalars(select(ProviderStatus))}


def _row(db: Session, provider: str) -> ProviderStatus:
    """The provider's row, created empty on first use."""
    row = db.get(ProviderStatus, provider)
    if row is None:
        row = ProviderStatus(provider=provider)
        db.add(row)
        db.flush()
    return row


def record_success(db: Session, provider: str, label: str) -> ProviderStatus:
    """Note that a call worked. Does not commit — the caller owns the transaction.

    The previous error is deliberately left in place: "it works now, and
    the last failure was yesterday at 3pm" is more useful than a board
    that forgets every problem the moment it stops happening.
    """
    row = _row(db, provider)
    row.last_success_at = datetime.now(timezone.utc)
    row.last_success_label = label[:80]
    return row


def record_failure(db: Session, provider: str, kind: str, detail: str = "") -> ProviderStatus:
    """Note that a call failed. Does not commit.

    `detail` is the provider's own message. Callers must pass a status
    line or error text, never a request that could carry the credential.
    """
    row = _row(db, provider)
    row.last_error_at = datetime.now(timezone.utc)
    row.last_error_kind = kind
    row.last_error_detail = detail[:300]
    return row


def explain(kind: str) -> str:
    """A failure code as a sentence a person can act on."""
    return PROVIDER_ERROR_LABEL.get(kind, PROVIDER_ERROR_LABEL[ProviderErrorKind.UNKNOWN])


# --------------------------------------------------------------- 확인


def check(db: Session, provider: str, settings: Settings) -> CheckResult:
    """Run the cheapest check available for one provider, and record it.

    Does not commit; the route does, so the status row and nothing else
    land together.
    """
    entry = next(item for item in PROVIDERS if item["key"] == provider)

    if settings.provider_is_mock(provider):
        # Nothing leaves the process. This is the honest answer: the mock
        # is working, and that is all a mock can tell you.
        result = CheckResult(
            ok=True,
            message=f"mock 모드입니다. {entry['name']}을(를) 부르지 않고 미리 정해진 응답을 돌려줍니다.",
        )
        record_success(db, provider, "연결 확인 (mock)")
        return result

    if not settings.provider_has_key(provider):
        result = CheckResult(
            ok=False,
            message=f"{entry['setting']}이(가) 실제 연결로 설정되어 있는데 API 키가 없습니다.",
            error_kind=ProviderErrorKind.AUTH,
        )
        record_failure(db, provider, ProviderErrorKind.AUTH, "credential not configured")
        return result

    if provider == "claude":
        result = _check_claude(settings)
    else:
        # The real adapter does not exist yet. Saying so is better than a
        # green light that means nothing, and better than a fake request.
        result = CheckResult(
            ok=False,
            message=(
                f"{entry['name']}의 실제 연동은 아직 만들어지지 않았습니다 "
                f"({entry['phase']}). 지금은 mock 모드로만 쓸 수 있습니다."
            ),
            error_kind=ProviderErrorKind.NOT_IMPLEMENTED,
        )

    if result.ok:
        record_success(db, provider, "연결 확인")
    else:
        record_failure(db, provider, result.error_kind, result.detail)
    return result


def _check_claude(settings: Settings) -> CheckResult:
    """List the models — validates the key without generating a token.

    `GET /v1/models` is the cheapest request the Anthropic API offers: it
    is not billed and consumes no tokens, so pressing the button has no
    cost beyond the round trip.
    """
    import httpx2 as httpx

    try:
        response = httpx.get(
            "https://api.anthropic.com/v1/models",
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            timeout=10.0,
        )
    except httpx.TimeoutException:
        return CheckResult(
            ok=False,
            message=explain(ProviderErrorKind.TIMEOUT),
            error_kind=ProviderErrorKind.TIMEOUT,
            detail="timeout after 10s",
        )
    except Exception as error:  # noqa: BLE001 — any transport failure is "unreachable"
        # The exception type only, never its text: a transport error can
        # repeat back the request, and the request carries the key.
        logger.warning("Claude connection check failed: %s", type(error).__name__)
        return CheckResult(
            ok=False,
            message=explain(ProviderErrorKind.UNAVAILABLE),
            error_kind=ProviderErrorKind.UNAVAILABLE,
            detail=type(error).__name__,
        )

    if response.status_code == 200:
        return CheckResult(ok=True, message="연결됐습니다. API 키가 정상입니다.")

    kind = {
        401: ProviderErrorKind.AUTH,
        403: ProviderErrorKind.AUTH,
        402: ProviderErrorKind.CREDIT,
        429: ProviderErrorKind.RATE_LIMITED,
    }.get(response.status_code, ProviderErrorKind.UNAVAILABLE)

    return CheckResult(
        ok=False,
        message=explain(kind),
        error_kind=kind,
        # The status line only. A response body can echo request details.
        detail=f"HTTP {response.status_code}",
    )
