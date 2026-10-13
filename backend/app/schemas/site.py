"""What the frontend needs to know about this deployment.

Public on purpose: the sign-up screen shows the data-location notice
before anyone has an account, and the beta banner belongs on the sign-in
screen too. Nothing here is a secret — it is what every visitor is told.
"""

from pydantic import BaseModel


class TestMode(BaseModel):
    """Which screens show "테스트 모드 – 실제 AI 결과가 아닙니다".

    True means the screen still runs on a mock and this is a deployed
    site, so a member could mistake the mock for the real thing. Always
    false in development, where everything is a mock and everyone knows.
    """

    chat: bool
    builder: bool
    video: bool
    # CtrlAIApps and CtrlAITube show example listings until Phases 5 and 8.
    community: bool


class SiteInfo(BaseModel):
    environment: str
    is_development: bool
    is_beta: bool
    data_location_notice: str
    top_ups_enabled: bool
    #: "Google로 계속하기" is offered (google-login).
    google_login: bool
    test_mode: TestMode
