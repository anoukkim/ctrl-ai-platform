"""CtrlAITube API schemas (promo-videos)."""

from datetime import datetime

from pydantic import BaseModel, Field


class TubeAuthor(BaseModel):
    username: str
    display_name: str
    #: "active" | "inactive" | "former" — for the badge beside the name.
    membership: str


class TubeCommentRead(BaseModel):
    id: int
    author: TubeAuthor | None
    body: str
    created_at: datetime
    updated_at: datetime
    #: Mine: the author may edit or delete it.
    mine: bool = False
    replies: list["TubeCommentRead"] = Field(default_factory=list)


class TubeVideoRead(BaseModel):
    id: int
    slug: str
    kind: str
    title: str
    description: str
    official: bool
    creator: TubeAuthor | None = None
    hosted_desktop_src: str = ""
    hosted_mobile_src: str = ""
    poster_desktop_src: str = ""
    poster_mobile_src: str = ""
    youtube_video_id: str | None = None
    duration_seconds: int
    published_at: datetime
    reactions: dict[str, int]
    my_reactions: list[str] = Field(default_factory=list)
    comment_count: int


class TubeVideoDetail(TubeVideoRead):
    comments: list[TubeCommentRead]


class TubeReactionToggle(BaseModel):
    kind: str


class TubeCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
    parent_id: int | None = None


class TubeCommentEdit(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class TubeReportCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class TubeAdminAction(BaseModel):
    reason: str = Field(default="", max_length=200)


class TubeResolve(BaseModel):
    note: str = Field(default="", max_length=500)


class TubeReportRead(BaseModel):
    id: int
    comment_id: int
    video_slug: str
    video_title: str
    reason: str
    excerpt: str
    reporter_username: str
    author_username: str
    created_at: datetime
    #: The comment is still there to hide or delete.
    comment_live: bool
