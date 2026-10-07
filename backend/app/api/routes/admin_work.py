"""Admin routes over member work — delete anyone's, and restore it.

Two things live here that member routes cannot do:

* **Reach a project that is not yours.** Every member route scopes by
  `owner_user_id`; these deliberately do not, which is exactly why they
  sit behind `require_admin` and why every change writes an audit row.
* **See deleted rows.** A soft-deleted project answers 404 everywhere
  else. This is the only place it is visible, and the only place it can
  be brought back.

A member deleting their own project is not logged: it is their work, and
an audit trail of members using the product normally is noise. An admin
reaching into someone else's library is the thing worth recording.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import AuditAction, BuilderProject, User, VideoProject
from app.schemas.work import DeletedItemRead, WorkKind
from app.services import audit

router = APIRouter(prefix="/admin", tags=["admin"])

#: The two products, keyed by the word that appears in the URL.
MODELS: dict[str, type[BuilderProject] | type[VideoProject]] = {
    "builder": BuilderProject,
    "video": VideoProject,
}

#: What each kind is called in Korean, for audit summaries and errors.
KIND_LABEL = {"builder": "프로젝트", "video": "영상 프로젝트"}


def _load(kind: str, item_id: int, db: Session) -> BuilderProject | VideoProject:
    """Load one item of either kind, deleted or not.

    An unknown `kind` is a 404 rather than a 422: `/admin/work/apps/3` is
    a path that does not exist, and saying so is more useful than a
    validation error about a literal type.
    """
    model = MODELS.get(kind)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{KIND_LABEL[kind]}을 찾을 수 없습니다.",
        )
    return item


def _as_read(kind: WorkKind, item: BuilderProject | VideoProject, owner: User | None) -> DeletedItemRead:
    return DeletedItemRead(
        kind=kind,
        id=item.id,
        name=item.name,
        owner_user_id=item.owner_user_id,
        owner_username=owner.username if owner else "",
        owner_display_name=owner.display_name if owner else "",
        deleted_at=item.deleted_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get(
    "/deleted-items",
    response_model=list[DeletedItemRead],
    summary="Deleted projects and videos, newest first",
)
def list_deleted_items(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[DeletedItemRead]:
    """Everything a member (or an admin) has deleted, both products in one list.

    Two queries rather than a UNION: the two tables do not have the same
    columns, and assembling the rows in Python keeps the response shape
    identical for both kinds.
    """
    items: list[DeletedItemRead] = []

    for kind, model in MODELS.items():
        rows = db.execute(
            select(model, User)
            .join(User, User.id == model.owner_user_id)
            .where(model.deleted_at.is_not(None))
        ).all()
        items.extend(_as_read(kind, item, owner) for item, owner in rows)

    items.sort(key=lambda item: item.deleted_at, reverse=True)
    return items


@router.post(
    "/work/{kind}/{item_id}/restore",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Restore a deleted project or video",
)
def restore_item(
    kind: str,
    item_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    """Put a deleted item back. The owner sees it again on their next request.

    Restoring something that is not deleted is refused rather than
    ignored: it means the list the admin acted on was stale, and a silent
    success would hide that.
    """
    item = _load(kind, item_id, db)
    if item.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="삭제된 항목이 아닙니다.",
        )

    owner = db.get(User, item.owner_user_id)
    deleted_at = item.deleted_at
    item.deleted_at = None

    audit.record(
        db,
        actor=admin,
        action=AuditAction.WORK_RESTORED,
        target_type=kind,
        target_id=item.id,
        target_label=owner.username if owner else "",
        summary=f"{owner.username if owner else '알 수 없는 회원'}의 {KIND_LABEL[kind]} '{item.name}'을 복구했습니다.",
        detail={"deleted_at": deleted_at.isoformat()},
    )
    db.commit()


@router.delete(
    "/work/{kind}/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete any member's project or video",
)
def delete_item(
    kind: str,
    item_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    """Delete someone else's work. Soft, like the member's own delete.

    Unlike the member route this is not gated on participation: an admin
    moderating content is not creating anything, and waiting for the
    quarter they happen to be enrolled in would be nonsense.
    """
    item = _load(kind, item_id, db)
    if item.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 삭제된 항목입니다.",
        )

    owner = db.get(User, item.owner_user_id)
    item.deleted_at = datetime.now(timezone.utc)

    audit.record(
        db,
        actor=admin,
        action=AuditAction.WORK_DELETED,
        target_type=kind,
        target_id=item.id,
        target_label=owner.username if owner else "",
        summary=f"{owner.username if owner else '알 수 없는 회원'}의 {KIND_LABEL[kind]} '{item.name}'을 삭제했습니다.",
    )
    db.commit()
