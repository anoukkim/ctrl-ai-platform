"""CtrlAITube — the feed, one video, reactions and comments (promo-videos).

Reads need a signed-in account (`get_current_user`); reacting and
commenting need a member taking part this quarter
(`require_active_member`); 신고 is any signed-in member, like an app's.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_active_member
from app.db.session import get_db
from app.models import TubeComment, TubeVideo, User
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
from app.services.quarters import current_quarter, membership_for

router = APIRouter(prefix="/tube", tags=["tube"])


def _author(db: Session, user: User | None) -> TubeAuthor | None:
    if user is None:
        return None
    quarter = current_quarter(db)
    membership = membership_for(db, user.id, quarter.id) if quarter else None
    if user.account_status.value == "former":
        status_name = "former"
    else:
        status_name = "active" if membership is not None and membership.status.value == "active" else "inactive"
    return TubeAuthor(username=user.username, display_name=user.display_name, membership=status_name)


def _video_read(db: Session, video: TubeVideo, user: User | None) -> dict:
    creator = db.get(User, video.creator_id) if video.creator_id else None
    return dict(
        id=video.id,
        slug=video.slug,
        kind=video.kind,
        title=video.title,
        description=video.description,
        official=video.official,
        creator=_author(db, creator),
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


def _comment_read(db: Session, view: tube.CommentView, user: User, authors: dict) -> TubeCommentRead:
    row = view.row
    if view.author is not None and view.author.id not in authors:
        authors[view.author.id] = _author(db, view.author)
    return TubeCommentRead(
        id=row.id,
        author=authors.get(view.author.id) if view.author else None,
        body=row.body,
        created_at=row.created_at,
        updated_at=row.updated_at,
        mine=row.user_id == user.id,
        replies=[_comment_read(db, reply, user, authors) for reply in view.replies],
    )


def _get(db: Session, slug: str) -> TubeVideo:
    try:
        return tube.get_video(db, slug)
    except tube.TubeError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error


@router.get("/videos", response_model=list[TubeVideoRead], summary="The feed: the club's video first")
def list_videos(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    rows = tube.list_videos(db)
    db.commit()  # the official row may have just been made
    return [_video_read(db, row, user) for row in rows]


@router.get("/videos/{slug}", response_model=TubeVideoDetail, summary="One video with its comments")
def read_video(slug: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    video = _get(db, slug)
    db.commit()
    authors: dict = {}
    comments = [_comment_read(db, view, user, authors) for view in tube.comment_tree(db, video)]
    return {**_video_read(db, video, user), "comments": comments}


@router.post("/videos/{slug}/reactions", summary="Toggle one reaction (좋아요 · 유용해요 · 흥미로워요)")
def toggle_reaction(
    slug: str, payload: TubeReactionToggle, db: Session = Depends(get_db), user: User = Depends(require_active_member)
) -> dict:
    video = _get(db, slug)
    try:
        on = tube.toggle_reaction(db, video, user, payload.kind)
    except tube.TubeError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
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
    video = _get(db, slug)
    try:
        row = tube.add_comment(db, video, user, payload.body, payload.parent_id)
    except tube.TubeError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    db.refresh(row)
    return _comment_read(db, tube.CommentView(row, user, []), user, {})


@router.patch("/comments/{comment_id}", response_model=TubeCommentRead, summary="Edit my comment")
def edit_comment(
    comment_id: int, payload: TubeCommentEdit, db: Session = Depends(get_db), user: User = Depends(require_active_member)
) -> TubeCommentRead:
    try:
        row = tube.edit_comment(db, user, comment_id, payload.body)
    except tube.TubeError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    db.refresh(row)
    return _comment_read(db, tube.CommentView(row, user, []), user, {})


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete my comment")
def delete_comment(comment_id: int, db: Session = Depends(get_db), user: User = Depends(require_active_member)) -> None:
    try:
        tube.delete_comment(db, user, comment_id)
    except tube.TubeError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()


@router.post("/comments/{comment_id}/report", status_code=status.HTTP_201_CREATED, summary="신고 a comment")
def report_comment(
    comment_id: int, payload: TubeReportCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    try:
        tube.report_comment(db, user, comment_id, payload.reason)
    except tube.TubeError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    db.commit()
    return {"detail": "신고를 받았어요. 관리자가 확인할게요."}


# Keep the import used for typing by tools that read this module.
_ = TubeComment
