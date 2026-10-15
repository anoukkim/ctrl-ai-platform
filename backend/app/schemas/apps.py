"""CtrlAIApps schemas (ctrlaiapps-publish)."""

from datetime import datetime

from pydantic import BaseModel, Field


class AppListing(BaseModel):
    """One published app, as the listing and the detail page show it."""

    id: int
    #: The public folder's name — the detail page's address.
    slug: str
    name: str
    description: str
    #: The author's display name, or "탈퇴 회원" — work stays attributed.
    author_name: str
    author_username: str = ""
    #: "v5 · 3일 전 업데이트".
    version_number: int
    published_at: datetime | None
    #: 업데이트 메모 — optional.
    publish_note: str = ""
    #: https://apps.ctrlai.my/<slug>/ — None while the runtime is off.
    app_url: str | None = None


class AppReportCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class AdminAppRead(AppListing):
    owner_id: int
    open_reports: int = 0
    #: An admin owns it (an example app): ZIP 미리보기 is offered.
    example: bool = False


class AdminReportRead(BaseModel):
    id: int
    project_id: int
    app_name: str
    app_slug: str
    reason: str
    reporter_username: str
    created_at: datetime
    #: The app is still on CtrlAIApps.
    still_listed: bool


class AdminUnpublish(BaseModel):
    reason: str = Field(default="", max_length=500)


class AdminResolve(BaseModel):
    note: str = Field(default="", max_length=500)
