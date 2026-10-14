"""`GET /api/site` — the deployment, as the frontend needs to see it.

The frontend image is built once and could run anywhere, so it does not
decide for itself whether this is the beta. It asks: the backend reads
APP_ENV and the provider settings at run time, and that answer drives the
beta banner, the test-mode labels, the top-up form and the data-location
notice on sign-up.

No guard: the sign-up and sign-in screens need it before anyone signs in,
and every field is something a visitor is told anyway.
"""

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.site import SiteInfo, TestMode
from app.services.google_login import google_login_available

router = APIRouter(tags=["site"])


@router.get("/site", response_model=SiteInfo, summary="This deployment, for the frontend")
def site_info(settings: Settings = Depends(get_settings)) -> SiteInfo:
    deployed = not settings.is_development
    claude_mock = settings.provider_is_mock("claude")
    return SiteInfo(
        environment=settings.app_env,
        is_development=settings.is_development,
        is_beta=settings.is_beta,
        data_location_notice=settings.data_location_notice.strip(),
        top_ups_enabled=settings.top_ups_enabled,
        google_login=google_login_available(settings),
        apps_base_url=settings.apps_base_url.strip().rstrip("/") or None,
        test_mode=TestMode(
            chat=deployed and claude_mock,
            # Project Builder's starter app is written by Claude.
            builder=deployed and claude_mock,
            video=deployed and settings.provider_is_mock("video"),
            community=deployed,
        ),
    )
