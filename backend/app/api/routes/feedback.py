"""Feedback: a member sends a short note, an admin reads the list.

Sending is open to every signed-in account, participating or not — an
inactive member who cannot create anything is exactly the person whose
complaint is worth reading. It spends nothing.

Screenshots (feedback-screenshots): uploaded one per request *before* the
note, the bytes as the body (`application/octet-stream`, like Chat's
attachments — the JSON-only rule of CLAUDE.md §2 refuses the "simple"
types a cross-site page could send without a preflight); the note then
names the uploaded ids. Only an admin can open a stored image.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.api.uploads import clean_upload_name, file_response, read_upload_body
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import FEEDBACK_MAX_LENGTH, FEEDBACK_PER_HOUR, AuditAction, Feedback, FeedbackImage, User
from app.schemas.feedback import FeedbackAdminRead, FeedbackCreate, FeedbackImageRead, FeedbackRead
from app.services import audit
from app.services import feedback_images as images_service
from app.services.attachments import MB, AttachmentRefusal
from app.services.storage import get_storage

router = APIRouter(tags=["feedback"])

#: The most rows Admin › Feedback shows. The beta has about 40 members.
ADMIN_LIST_LIMIT = 500


def _image_read(row: FeedbackImage) -> FeedbackImageRead:
    return FeedbackImageRead(
        id=row.id,
        name=row.original_name,
        size=row.stored_size,
        width=row.width,
        height=row.height,
        media_type=row.media_type,
    )


@router.post(
    "/feedback/images",
    response_model=FeedbackImageRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload one screenshot for the next note (the body is the file's bytes)",
)
async def upload_feedback_image(
    request: Request,
    name: str = Query(min_length=1, max_length=255),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FeedbackImageRead:
    """Read only up to the limit plus one byte, check everything, then store."""
    cap = settings.feedback_images_per_note
    if len(images_service.pending_for(db, user.id)) >= cap:
        # Pictures left behind by a dialog that never closed (tab closed)
        # must not block this member for good: at the cap, and only then,
        # day-old leftovers are swept before the count is final.
        swept = images_service.sweep_abandoned(db, user.id)
        if swept:
            db.commit()
            images_service.delete_bytes(get_storage(settings), swept)
        if len(images_service.pending_for(db, user.id)) >= cap:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=images_service.too_many(cap))
    data = await read_upload_body(
        request,
        settings.feedback_image_max_mb * MB,
        images_service.too_big(settings.feedback_image_max_mb),
        "사진은 application/octet-stream 형식으로 보내 주세요.",
    )
    original = clean_upload_name(name, "image")

    try:
        checked = await run_in_threadpool(images_service.check_image, original, data)
        images_service.check_room(db, user.id, checked, settings)
    except AttachmentRefusal as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=str(refusal)) from refusal

    row = FeedbackImage(
        user_id=user.id,
        media_type=checked.media_type,
        original_name=original,
        stored_size=len(checked.data),
        width=checked.width or 0,
        height=checked.height or 0,
    )
    db.add(row)
    db.flush()
    row.storage_key = images_service.storage_key(row)
    get_storage(settings).save(row.storage_key, checked.data)
    db.commit()
    db.refresh(row)
    return _image_read(row)


@router.delete(
    "/feedback/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a screenshot not sent yet (✕ in the dialog)",
)
def delete_feedback_image(
    image_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    row = db.get(FeedbackImage, image_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=images_service.NOT_YOURS)
    if row.feedback_id is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=images_service.ALREADY_SENT)
    keys = images_service.delete_rows(db, [row])
    db.commit()
    images_service.delete_bytes(get_storage(settings), keys)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/feedback",
    response_model=FeedbackRead,
    status_code=status.HTTP_201_CREATED,
    summary="Send feedback",
)
def send_feedback(
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FeedbackRead:
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="내용을 적어 주세요.")
    if len(body) > FEEDBACK_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"{FEEDBACK_MAX_LENGTH:,}자 이내로 적어 주세요.",
        )

    # The screenshots must be this member's own, still waiting, and no more
    # than the limit — an id of someone else's image is simply "not found".
    wanted = list(dict.fromkeys(payload.image_ids))
    if len(wanted) > settings.feedback_images_per_note:
        raise HTTPException(status_code=400, detail=images_service.too_many(settings.feedback_images_per_note))
    pending = images_service.pending_for(db, user.id)
    by_id = {row.id: row for row in pending}
    if any(image_id not in by_id for image_id in wanted):
        raise HTTPException(status_code=400, detail=images_service.NOT_YOURS)

    # Counted from saved rows, like Chat's rate limit: nothing to keep in
    # memory, and it holds across API workers.
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = db.scalar(
        select(func.count(Feedback.id)).where(
            Feedback.user_id == user.id, Feedback.created_at >= since
        )
    )
    if (recent or 0) >= FEEDBACK_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail="의견을 너무 자주 보내셨어요. 잠시 후 다시 보내 주세요.",
        )

    row = Feedback(
        user_id=user.id,
        body=body,
        page=payload.page.strip()[:200],
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.flush()
    attached = [by_id[image_id] for image_id in wanted]
    for image in attached:
        image.feedback_id = row.id
    # Whatever else was uploaded and not named was abandoned in an earlier
    # dialog (closed without sending): gone with this note, so a member
    # never holds more than one note's worth of waiting pictures.
    abandoned = [image for image in pending if image.id not in wanted]
    keys = images_service.delete_rows(db, abandoned)
    db.commit()
    db.refresh(row)
    images_service.delete_bytes(get_storage(settings), keys)
    return FeedbackRead(
        id=row.id,
        body=row.body,
        page=row.page,
        created_at=row.created_at,
        images=[_image_read(image) for image in attached],
    )


# ------------------------------------------------------------- admin


@router.get(
    "/admin/feedback",
    response_model=list[FeedbackAdminRead],
    summary="Feedback members sent, newest first",
)
def list_feedback(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[FeedbackAdminRead]:
    rows = db.execute(
        select(Feedback, User)
        .outerjoin(User, User.id == Feedback.user_id)
        .order_by(Feedback.created_at.desc(), Feedback.id.desc())
        .limit(ADMIN_LIST_LIMIT)
    ).all()
    images_by_note: dict[int, list[FeedbackImageRead]] = {}
    if rows:
        for image in db.scalars(
            select(FeedbackImage)
            .where(FeedbackImage.feedback_id.in_([feedback.id for feedback, _ in rows]))
            .order_by(FeedbackImage.id)
        ):
            images_by_note.setdefault(image.feedback_id or 0, []).append(_image_read(image))
    return [
        FeedbackAdminRead(
            id=feedback.id,
            body=feedback.body,
            page=feedback.page,
            created_at=feedback.created_at,
            images=images_by_note.get(feedback.id, []),
            user_id=feedback.user_id,
            username=author.username if author else None,
            display_name=author.display_name if author else None,
        )
        for feedback, author in rows
    ]


@router.get(
    "/admin/feedback/images/{image_id}/file",
    summary="A screenshot a member attached — admins only",
)
def feedback_image_file(
    image_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> Response:
    row = db.get(FeedbackImage, image_id)
    if row is None or row.feedback_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사진을 찾을 수 없습니다.")
    try:
        data = get_storage(settings).load(row.storage_key)
    except (FileNotFoundError, OSError) as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사진을 찾을 수 없습니다.") from error
    # A member's upload, shown to the admin — never a page of this site.
    return file_response(data, row.media_type, row.original_name, inline=True)


@router.delete(
    "/admin/feedback/{feedback_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a note and its screenshots",
)
def delete_feedback(
    feedback_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The one way a note disappears. Audited; the bytes go with the rows."""
    row = db.get(Feedback, feedback_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="의견을 찾을 수 없습니다.")
    images = list(db.scalars(select(FeedbackImage).where(FeedbackImage.feedback_id == row.id)))
    author = db.get(User, row.user_id) if row.user_id is not None else None
    audit.record(
        db,
        actor=admin,
        action=AuditAction.FEEDBACK_DELETED,
        target_type="feedback",
        target_id=row.id,
        target_label=author.username if author else "",
        summary=(
            f"{author.username if author else '삭제된 계정'}의 의견을 지웠습니다"
            + (f" (사진 {len(images)}장 포함)." if images else ".")
        ),
        detail={"page": row.page, "images": len(images), "sent_at": row.created_at.isoformat()},
    )
    keys = images_service.delete_rows(db, images)
    db.delete(row)
    db.commit()
    images_service.delete_bytes(get_storage(settings), keys)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
