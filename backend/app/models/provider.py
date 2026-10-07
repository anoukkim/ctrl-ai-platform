"""What each external provider last did.

The Admin 시스템 screen answers one question per provider: *is this
working?* That cannot be answered from configuration alone — a key can be
present and rejected, and a service can be reachable one minute and down
the next. So the provider layer records the outcome of each call here,
and the screen reads it.

Three decisions worth knowing:

* **The key is never stored here.** Only whether a call succeeded. The
  credential stays in configuration, and no route returns it.
* **One row per provider, updated in place.** This is a status board, not
  a log — the audit trail of member-affecting changes is `audit_logs`,
  and provider traffic does not belong in it.
* **The error is kept twice**: `last_error_detail` as the provider said
  it, and `last_error_kind` as a code the screen turns into a Korean
  sentence. Keeping the raw text would leave the Admin screen showing
  English from someone else's API; keeping only the code would lose the
  detail needed to debug it.
"""

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProviderErrorKind:
    """Why a provider call failed, as plain strings.

    Deliberately not an enum with a CHECK constraint, for the same reason
    `AuditAction` is not: a provider inventing a new failure must never
    make the record of it unwritable.
    """

    AUTH = "auth"  # key missing, wrong, or revoked
    CREDIT = "credit"  # out of credit or over a quota
    RATE_LIMITED = "rate_limited"  # too many requests for now; retry later
    UNAVAILABLE = "unavailable"  # the service is down or unreachable
    TIMEOUT = "timeout"
    NOT_IMPLEMENTED = "not_implemented"  # real adapter not built yet
    UNKNOWN = "unknown"


#: What the member-facing screen says for each kind. Korean, because this
#: is read by a person; the provider's own English text is kept separately.
PROVIDER_ERROR_LABEL: dict[str, str] = {
    ProviderErrorKind.AUTH: "API 키가 거부되었습니다. 키가 잘못되었거나 만료되었습니다.",
    ProviderErrorKind.CREDIT: "제공자 쪽 잔액이나 사용 한도가 바닥났습니다.",
    ProviderErrorKind.UNAVAILABLE: "제공자 서비스에 연결할 수 없습니다.",
    ProviderErrorKind.RATE_LIMITED: "제공자의 요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.",
    ProviderErrorKind.TIMEOUT: "제공자가 제시간에 응답하지 않았습니다.",
    ProviderErrorKind.NOT_IMPLEMENTED: "실제 연동이 아직 만들어지지 않았습니다.",
    ProviderErrorKind.UNKNOWN: "알 수 없는 오류입니다.",
}


class ProviderStatus(Base):
    """The last thing that happened with one provider."""

    __tablename__ = "provider_status"

    #: "claude" / "video" / "github" / "youtube" — the same keys the
    #: settings use, so configuration and status cannot drift apart.
    provider: Mapped[str] = mapped_column(String(20), primary_key=True)

    last_success_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: What the successful call was ("연결 확인", "메시지 생성"), so the
    #: screen can say more than "it worked at 14:02".
    last_success_label: Mapped[str] = mapped_column(String(80), default="", nullable=False)

    last_error_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error_kind: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    #: The provider's own message, kept for debugging. Never a credential:
    #: `app/services/providers.py` records only the status line, and the
    #: key is not part of a response body.
    last_error_detail: Mapped[str] = mapped_column(String(300), default="", nullable=False)

    def __repr__(self) -> str:
        return f"<ProviderStatus {self.provider}>"
