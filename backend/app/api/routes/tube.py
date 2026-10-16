"""CtrlAITube — the feed, one video, reactions and comments (promo-videos).

Reads need a signed-in account (`get_current_user`); reacting and
commenting need a member taking part this quarter
(`require_active_member`); 신고 is any signed-in member, like an app's.
A `TubeError` becomes its status and Korean message in `app.main`.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_active_member
from app.db.session import get_db
from app.models import MembershipStatus, QuarterMembership, TubeVideo, User
from app.schemas.tube import (
    TubeAuthor,
    TubeCommentCreate,
    TubeCommentEdit,
    TubeCommentRead,
    TubeReactionToggle,
    TubeReportCreate,
    TubeVideoDetail,
    TubeVideoRead,
)
from app.services import tube
from app.services.quarters import current_quarter

router = APIRouter(prefix="/tube", tags=["tube"])


class _Authors:
    """Author badges for one request: the quarter is read once and the
    memberships of every author in one query, however many comment."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.quarter = current_quarter(db)
        self.cache: dict[int, TubeAuthor] = {}

    def load(self, users: list[User]) -> None:
        missing = [u for u in users if u.id not in self.cache]
        if not missing:
            return
        active: set[int] = set()
        if self.quarter is not None:
            active = set(
                self.db.scalars(
                    select(QuarterMembership.user_id).where(
                        QuarterMembership.quarter_id == self.quarter.id,
                        QuarterMembership.user_id.in_([u.id for u in missing]),
                        QuarterMembership.status == MembershipStatus.ACTIVE,
                    )
                )
            )
        for user in missing:
            if user.account_status.value == "former":
                status_name = "former"
            else:
                status_name = "active" if user.id in active else "inactive"
            self.cache[user.id] = TubeAuthor(
                username=user.username, display_name=user.display_name, membership=status_name
            )

    def of(self, user: User | None) -> TubeAuthor | None:
        if user is None:
            return None
        self.load([user])
        return self.cache[user.id]


def _video_read(db: Session, video: TubeVideo, user: User | None, authors: _Authors) -> dict:
    creator = db.get(User, video.creator_id) if video.creator_id else None
    return dict(
        id=video.id,
        slug=video.slug,
        kind=video.kind,
        title=video.title,
        description=video.description,
        official=video.official,
        creator=authors.of(creator),
        hosted_desktop_src=video.hosted_desktop_src,
        hosted_mobile_src=video.hosted_mobile_src,
        poster_desktop_src=video.poster_desktop_src,
        poster_mobile_src=video.poster_mobile_src,
        youtube_video_id=video.youtube_video_id,
        duration_seconds=video.duration_seconds,
        published_at=video.published_at,
        reactions=tube.reaction_counts(db, video),
        my_reactions=tube.my_reactions(db, video, user),
        comment_count=tube.count_comments(db, video),
    )


def _comment_read(view: tube.CommentView, user: User, authors: _Authors) -> TubeCommentRead:
    row = view.row
    return TubeCommentRead(
        id=row.id,
        author=authors.of(view.author),
        body=row.body,
        created_at=row.created_at,
        updated_at=row.updated_at,
        mine=row.user_id == user.id,
        replies=[_comment_read(reply, user, authors) for reply in view.replies],
    )


@router.get("/videos", response_model=list[TubeVideoRead], summary="The feed: the club's video first")
def list_videos(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    rows = tube.list_videos(db)
    db.commit()  # the official row may have just been made
    authors = _Authors(db)
    return [_video_read(db, row, user, authors) for row in rows]


@router.get("/videos/{slug}", response_model=TubeVideoDetail, summary="One video with its comments")
def read_video(slug: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    video = tube.get_video(db, slug)
    db.commit()
    authors = _Authors(db)
    tree = tube.comment_tree(db, video)
    authors.load(tube.authors_in(tree))
    comments = [_comment_read(view, user, authors) for view in tree]
    return {**_video_read(db, video, user, authors), "comments": comments}


@router.post("/videos/{slug}/reactions", summary="Toggle one reaction (좋아요 · 유용해요 · 흥미로워요)")
def toggle_reaction(
    slug: str, payload: TubeReactionToggle, db: Session = Depends(get_db), user: User = Depends(require_active_member)
) -> dict:
    video = tube.get_video(db, slug)
    on = tube.toggle_reaction(db, video, user, payload.kind)
    db.commit()
    return {"kind": payload.kind, "on": on, "reactions": tube.reaction_counts(db, video)}


@router.post(
    "/videos/{slug}/comments",
    response_model=TubeCommentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Write a comment or a reply",
)
def create_comment(
    slug: str, payload: TubeCommentCreate, db: Session = Depends(get_db), user: User = Depends(require_active_member)
) -> TubeCommentRead:
    video = tube.get_video(db, slug)
    row = tube.add_comment(db, video, user, payload.body, payload.parent_id)
    db.commit()
    db.refresh(row)
    return _comment_read(tube.CommentView(row, user, []), user, _Authors(db))


@router.patch("/comments/{comment_id}", response_model=TubeCommentRead, summary="Edit my comment")
def edit_comment(
    comment_id: int, payload: TubeCommentEdit, db: Session = Depends(get_db), user: User = Depends(require_active_member)
) -> TubeCommentRead:
    row = tube.edit_comment(db, user, comment_id, payload.body)
    db.commit()
    db.refresh(row)
    return _comment_read(tube.CommentView(row, user, []), user, _Authors(db))


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete my comment")
def delete_comment(comment_id: int, db: Session = Depends(get_db), user: User = Depends(require_active_member)) -> None:
    tube.delete_comment(db, user, comment_id)
    db.commit()


@router.post("/comments/{comment_id}/report", status_code=status.HTTP_201_CREATED, summary="신고 a comment")
def report_comment(
    comment_id: int, payload: TubeReportCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    tube.report_comment(db, user, comment_id, payload.reason)
    db.commit()
    return {"detail": "신고를 받았어요. 관리자가 확인할게요."}

