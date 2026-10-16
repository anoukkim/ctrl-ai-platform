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
    #: app-platform P2: the 기능 상자 runs (False = stopped by an admin).
    sdk_enabled: bool = True
    sdk_disabled_reason: str = ""
    #: app-platform P3: what the live app holds in `ctrlai.db`.
    data_items: int = 0
    data_bytes: int = 0


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
    #: app-platform P3: a report of one shared item, with what it said.
    data_item_id: int | None = None
    item_excerpt: str = ""
    #: The item is still there to hide or delete.
    item_live: bool = False


class AdminUnpublish(BaseModel):
    reason: str = Field(default="", max_length=500)


class AdminSdkSet(BaseModel):
    """기능 상자 정지 / 재개 (app-platform P2). A reason is required to stop."""

    enabled: bool
    reason: str = Field(default="", max_length=200)


class AdminResolve(BaseModel):
    note: str = Field(default="", max_length=500)


class AdminDataCollectionRead(BaseModel):
    """One collection of an app's `ctrlai.db` (app-platform P3)."""

    name: str
    kind: str
    items: int
    bytes: int


class AdminDataItemRead(BaseModel):
    """A shared item, as the admin sees it: the data and who wrote it."""

    id: int
    collection: str
    data: dict
    size_bytes: int
    author_username: str
    created_at: datetime
    open_reports: int = 0


class AdminDataRead(BaseModel):
    items: int
    bytes: int
    collections: list[AdminDataCollectionRead]
    #: Shared items, newest first (at most 200).
    shared: list[AdminDataItemRead]


class AdminDataAction(BaseModel):
    """숨기기 / 지우기 of one item (audited). A reason is required."""

    reason: str = Field(default="", max_length=200)
