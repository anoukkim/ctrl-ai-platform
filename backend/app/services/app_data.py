"""CTRL+AI 기능 상자 — `ctrlai.db`, the per-app database (app-platform P3).

An app keeps its data in **collections** — named lists of JSON objects.
A collection is a **(name, kind)** pair, and the kind is part of every
call (`shared: true/false`, false unless the app says so): `posts` private
and `posts` shared are two different lists, so the first visitor to write
can never decide what everyone else's writes mean. Two kinds:

* **private** — each signed-in visitor sees and changes only their own
  items (a diary, a score history). Signed out: nothing.
* **shared** — everyone reads, signed-out visitors included; signed-in
  members write (a board, a ranking, a poll). Each item shows its author's
  display name — the consent screen says so.

A collection exists because the app's **owner** declared it — in the
project's `ctrlai.json` (`services/app_manifest.py`, read when the files
reach the runtime) or by saving into it first from inside the app. A
visitor's save into a list that does not exist is refused
(`no_collection`), so nobody but the owner decides what lists an app has
(security review of P3, 2026-10-16).

Who may change an item: its author. The app's owner may also delete any
shared item of their app (from inside the app, as a visitor). An admin
hides or deletes from Admin › Content (audited); hidden items are gone for
everyone. `report` puts a shared item in the admin's queue.

Limits: an item is a JSON object of at most 4 KB; an app holds at most
2,000 items and 5 MB, in at most 20 collections; a visitor makes at most
30 writes a minute in one app. Reads are bounded the same way — `list` and
`count` look at one collection of one app, never more than 2,000 rows — so
filtering and sorting happen here, in Python, the same on PostgreSQL and
on the tests' SQLite. No raw SQL reaches this module, and every lookup is
scoped to one project and one space; the caller (`app_request`) has
already refused deleted and unpublished apps (CLAUDE.md §10).

The Builder's 미리보기 has a space of its own ("preview"), so the creator
trying their app never writes into the live app's data.
"""

from __future__ import annotations

import json
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    AccountStatus,
    AppConsent,
    AppDataCollection,
    AppDataItem,
    AppDataWrite,
    AppReport,
    AuditAction,
    BuilderProject,
    User,
)
from app.services import audit

PRIVATE = "private"
SHARED = "shared"

MAX_ITEM_BYTES = 4 * 1024
MAX_APP_BYTES = 5 * 1024 * 1024
MAX_APP_ITEMS = 2000
MAX_COLLECTIONS = 20
WRITES_PER_MINUTE = 30
MAX_LIMIT = 100
DEFAULT_LIMIT = 20
MAX_WHERE_FIELDS = 5
MAX_REASON_CHARS = 500
EXCERPT_CHARS = 300

COLLECTION_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
FIELD_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,39}$")
ITEM_ID_PATTERN = re.compile(r"^d_[A-Za-z0-9_-]{8,14}$")
#: Ordering by when, besides any top-level field of the items.
TIME_FIELDS = {"createdAt": "created_at", "updatedAt": "updated_at"}


class AppDataError(Exception):
    """A refusal, in Korean, with the HTTP status and a code for the SDK."""

    def __init__(self, message: str, status_code: int = 400, code: str = "invalid") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


NOT_FOUND = "항목을 찾을 수 없어요."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def space_of(mode: str) -> str:
    """The shell's mode ("app" / "preview") is the data's space."""
    return "preview" if mode == "preview" else "app"


# ------------------------------------------------------------- checking input


def check_collection(name: object) -> str:
    if not isinstance(name, str) or not COLLECTION_PATTERN.match(name):
        raise AppDataError("목록 이름은 영문·숫자·_·- 로 1~40자여야 해요.")
    return name


def encoded_size(data: dict) -> int:
    return len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def check_data(data: object) -> tuple[dict, int]:
    """An item is a JSON object of at most 4 KB."""
    if not isinstance(data, dict):
        raise AppDataError("저장할 값은 객체({ ... })여야 해요.")
    size = encoded_size(data)
    if size > MAX_ITEM_BYTES:
        raise AppDataError(
            f"항목 하나는 4KB까지예요 (지금 {size:,}바이트). 내용을 줄이거나 나눠 저장해 주세요.", 413, "too_large"
        )
    return data, size


def check_where(where: object) -> dict:
    """Simple equality on top-level fields: `{ field: value }`, value a
    string, number, true/false or null; at most five fields."""
    if where is None:
        return {}
    if not isinstance(where, dict):
        raise AppDataError("where는 { 필드: 값 } 모양이어야 해요.")
    if len(where) > MAX_WHERE_FIELDS:
        raise AppDataError(f"where에는 필드를 {MAX_WHERE_FIELDS}개까지 쓸 수 있어요.")
    for field, value in where.items():
        if not FIELD_PATTERN.match(field):
            raise AppDataError(f"where의 필드 이름이 올바르지 않아요: {field[:40]}")
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise AppDataError("where의 값은 글자, 숫자, true/false, null만 쓸 수 있어요.")
    return where


@dataclass(frozen=True)
class ListOptions:
    where: dict
    order_by: str
    descending: bool
    limit: int
    offset: int
    mine: bool


def list_options(
    where: object = None,
    order_by: object = "createdAt",
    order: object = None,
    limit: object = DEFAULT_LIMIT,
    cursor: object = None,
    mine: object = False,
) -> ListOptions:
    order_by = order_by or "createdAt"
    if not isinstance(order_by, str) or not (order_by in TIME_FIELDS or FIELD_PATTERN.match(order_by)):
        raise AppDataError("orderBy는 createdAt, updatedAt 또는 필드 이름이어야 해요.")
    if order not in (None, "asc", "desc"):
        raise AppDataError('order는 "asc" 또는 "desc"여야 해요.')
    # Newest first by default for the times; fields go up (A→Z, 1→9).
    descending = order == "desc" if order else order_by in TIME_FIELDS
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT:
        raise AppDataError(f"limit은 1~{MAX_LIMIT} 사이의 정수여야 해요.")
    offset = 0
    if cursor not in (None, ""):
        if not isinstance(cursor, str) or not cursor.startswith("c") or not cursor[1:].isdigit():
            raise AppDataError("cursor가 올바르지 않아요. 앞에서 받은 nextCursor를 그대로 넘겨 주세요.")
        offset = int(cursor[1:])
    return ListOptions(check_where(where), order_by, descending, limit, offset, bool(mine))


# --------------------------------------------------------------- the reader


@dataclass(frozen=True)
class Reader:
    """Who is asking: one app, one space, and the signed-in visitor if any."""

    project: BuilderProject
    space: str
    user: User | None

    @property
    def is_app_owner(self) -> bool:
        return self.user is not None and self.user.id == self.project.owner_user_id


def kind_of(shared: object) -> str:
    """Only `True` means shared; anything else (false, null, missing) is private."""
    return SHARED if shared is True else PRIVATE


def _collection(db: Session, reader: Reader, name: str, kind: str) -> AppDataCollection | None:
    return db.scalar(
        select(AppDataCollection).where(
            AppDataCollection.project_id == reader.project.id,
            AppDataCollection.space == reader.space,
            AppDataCollection.name == name,
            AppDataCollection.kind == kind,
        )
    )


def _readable(kind: str, reader: Reader) -> None:
    """Checked before the lookup: a signed-out visitor learns nothing about
    a private list, not even whether it exists."""
    if kind == PRIVATE and reader.user is None:
        raise AppDataError("개인 목록은 로그인한 CTRL+AI 회원만 볼 수 있어요.", 401, "login_required")


def _visible(db: Session, collection: AppDataCollection, reader: Reader, mine: bool):
    query = select(AppDataItem).where(
        AppDataItem.collection_id == collection.id,
        AppDataItem.project_id == reader.project.id,
        AppDataItem.space == reader.space,
        AppDataItem.hidden_at.is_(None),
    )
    if collection.kind == PRIVATE or mine:
        if reader.user is None:
            return []
        query = query.where(AppDataItem.author_user_id == reader.user.id)
    return list(db.scalars(query.order_by(AppDataItem.id)))


def _matches(item: AppDataItem, where: dict) -> bool:
    data = item.data if isinstance(item.data, dict) else {}
    for field, wanted in where.items():
        if field not in data:
            return False
        value = data[field]
        # 1 and true are different answers to "where done = true".
        if isinstance(value, bool) != isinstance(wanted, bool) or value != wanted:
            return False
    return True


def _sort_key(order_by: str):
    """Rows arrive in id order and the sort is stable (also with
    `reverse`), so equal values keep their creation order either way."""
    if order_by in TIME_FIELDS:
        attribute = TIME_FIELDS[order_by]
        return lambda item: (0, _aware(getattr(item, attribute)))

    def key(item: AppDataItem):
        value = (item.data or {}).get(order_by) if isinstance(item.data, dict) else None
        # Numbers before text before true/false; items without the field last.
        if isinstance(value, bool):
            return (2, (int(value), ""))
        if isinstance(value, (int, float)):
            return (0, (value, ""))
        if isinstance(value, str):
            return (1, (0, value))
        return (3, (0, ""))

    return key


def _names(db: Session, items: list[AppDataItem]) -> dict[int, User]:
    ids = {item.author_user_id for item in items if item.author_user_id is not None}
    if not ids:
        return {}
    return {user.id: user for user in db.scalars(select(User).where(User.id.in_(ids)))}


def _app_user_ids(db: Session, project: BuilderProject, user_ids: set[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(AppConsent.user_id, AppConsent.app_user_id).where(
            AppConsent.project_id == project.id, AppConsent.user_id.in_(user_ids)
        )
    ).all()
    return dict(rows)


def _iso(moment: datetime) -> str:
    return _aware(moment).isoformat().replace("+00:00", "Z")


def present(db: Session, reader: Reader, items: list[AppDataItem]) -> list[dict]:
    """What the app sees of an item: its id, data, times, whether it is the
    visitor's own, whether they may delete it, and the author's display
    name and per-app id (never an email, username or balance)."""
    users = _names(db, items)
    app_ids = _app_user_ids(db, reader.project, set(users))
    out = []
    for item in items:
        author = users.get(item.author_user_id) if item.author_user_id is not None else None
        mine = reader.user is not None and item.author_user_id == reader.user.id
        if author is None or author.account_status is AccountStatus.FORMER:
            who = {"displayName": "탈퇴 회원", "appUserId": None}
        else:
            who = {"displayName": author.display_name, "appUserId": app_ids.get(author.id)}
        out.append(
            {
                "id": item.public_id,
                "data": item.data,
                "createdAt": _iso(item.created_at),
                "updatedAt": _iso(item.updated_at),
                "mine": mine,
                "canDelete": mine or reader.is_app_owner,
                "author": who,
            }
        )
    return out


def list_items(db: Session, reader: Reader, name: str, shared: object, options: ListOptions) -> dict:
    _readable(kind_of(shared), reader)
    collection = _collection(db, reader, check_collection(name), kind_of(shared))
    if collection is None:
        return {"items": [], "nextCursor": None}
    rows = [item for item in _visible(db, collection, reader, options.mine) if _matches(item, options.where)]
    rows.sort(key=_sort_key(options.order_by), reverse=options.descending)
    page = rows[options.offset : options.offset + options.limit]
    after = options.offset + len(page)
    return {"items": present(db, reader, page), "nextCursor": f"c{after}" if after < len(rows) else None}


def count_items(
    db: Session, reader: Reader, name: str, shared: object, where: object = None, mine: object = False
) -> int:
    conditions = check_where(where)
    _readable(kind_of(shared), reader)
    collection = _collection(db, reader, check_collection(name), kind_of(shared))
    if collection is None:
        return 0
    return sum(1 for item in _visible(db, collection, reader, bool(mine)) if _matches(item, conditions))


def _item(db: Session, reader: Reader, collection: AppDataCollection, item_id: object) -> AppDataItem:
    if not isinstance(item_id, str) or not ITEM_ID_PATTERN.match(item_id):
        raise AppDataError(NOT_FOUND, 404, "not_found")
    item = db.scalar(
        select(AppDataItem).where(
            AppDataItem.public_id == item_id,
            AppDataItem.collection_id == collection.id,
            AppDataItem.project_id == reader.project.id,
            AppDataItem.space == reader.space,
            AppDataItem.hidden_at.is_(None),
        )
    )
    # Someone else's private item does not exist, as far as this visitor knows.
    if item is None or (
        collection.kind == PRIVATE and (reader.user is None or item.author_user_id != reader.user.id)
    ):
        raise AppDataError(NOT_FOUND, 404, "not_found")
    return item


def get_item(db: Session, reader: Reader, name: str, shared: object, item_id: object) -> dict | None:
    _readable(kind_of(shared), reader)
    collection = _collection(db, reader, check_collection(name), kind_of(shared))
    if collection is None:
        return None
    try:
        item = _item(db, reader, collection, item_id)
    except AppDataError as error:
        if error.code == "not_found":
            return None
        raise
    return present(db, reader, [item])[0]


# --------------------------------------------------------------- the writer


def _writer(reader: Reader) -> User:
    if reader.user is None:
        raise AppDataError("CTRL+AI 회원만 쓸 수 있어요. 로그인해 주세요.", 401, "login_required")
    return reader.user


def _note_write(db: Session, reader: Reader, user: User) -> None:
    """At most 30 writes a minute per visitor in one app."""
    now = _now()
    since = now - timedelta(minutes=1)
    db.execute(
        delete(AppDataWrite).where(
            AppDataWrite.user_id == user.id,
            AppDataWrite.project_id == reader.project.id,
            AppDataWrite.created_at < since,
        )
    )
    recent = db.scalar(
        select(func.count(AppDataWrite.id)).where(
            AppDataWrite.user_id == user.id,
            AppDataWrite.project_id == reader.project.id,
            AppDataWrite.created_at >= since,
        )
    )
    if int(recent or 0) >= WRITES_PER_MINUTE:
        raise AppDataError(
            f"너무 자주 저장하고 있어요. 한 앱에서 1분에 {WRITES_PER_MINUTE}번까지예요. 잠시 후 다시 해 주세요.",
            429,
            "rate",
        )
    db.add(AppDataWrite(user_id=user.id, project_id=reader.project.id, created_at=now))


def _lock_app(db: Session, reader: Reader) -> None:
    """One writer at a time per app, so two saves cannot both slip under
    the quota (PostgreSQL; SQLite has one writer anyway)."""
    db.scalar(select(BuilderProject.id).where(BuilderProject.id == reader.project.id).with_for_update())


def _usage(db: Session, reader: Reader) -> tuple[int, int]:
    count, size = db.execute(
        select(func.count(AppDataItem.id), func.coalesce(func.sum(AppDataItem.size_bytes), 0)).where(
            AppDataItem.project_id == reader.project.id, AppDataItem.space == reader.space
        )
    ).one()
    return int(count or 0), int(size or 0)


def _check_room(db: Session, reader: Reader, extra_items: int, extra_bytes: int) -> None:
    count, size = _usage(db, reader)
    if count + extra_items > MAX_APP_ITEMS:
        raise AppDataError(
            f"이 앱의 데이터가 가득 찼어요 (항목 {MAX_APP_ITEMS:,}개까지). 오래된 항목을 지워 주세요.", 409, "full"
        )
    if size + extra_bytes > MAX_APP_BYTES:
        raise AppDataError("이 앱의 데이터가 가득 찼어요 (5MB까지). 오래된 항목을 지워 주세요.", 409, "full")


def save_item(db: Session, reader: Reader, name: str, shared: object, data: object) -> dict:
    """A new item in the (name, kind) collection. The collection comes from
    ctrlai.json or the **owner's** first save; a visitor's earlier write
    under the same name but the other kind is a different collection and
    changes nothing here."""
    user = _writer(reader)
    name = check_collection(name)
    kind = kind_of(shared)
    data, size = check_data(data)
    _lock_app(db, reader)
    _note_write(db, reader, user)
    collection = _collection(db, reader, name, kind)
    if collection is None:
        # app-platform P4 (security review): a list exists because the app's
        # owner declared it (ctrlai.json) or saved into it first — never
        # because a visitor named it. So no visitor can use up an app's
        # twenty lists, and a list's kind is always the app's own choice.
        if not reader.is_app_owner:
            raise AppDataError(
                f"이 앱에 '{name}' 목록이 아직 없어요. 앱을 만든 사람이 ctrlai.json에 적어야 해요.",
                404,
                "no_collection",
            )
        collections = db.scalar(
            select(func.count(AppDataCollection.id)).where(
                AppDataCollection.project_id == reader.project.id, AppDataCollection.space == reader.space
            )
        )
        if int(collections or 0) >= MAX_COLLECTIONS:
            raise AppDataError(f"한 앱에는 목록을 {MAX_COLLECTIONS}개까지 만들 수 있어요.", 409, "full")
        collection = AppDataCollection(project_id=reader.project.id, space=reader.space, name=name, kind=kind)
        db.add(collection)
        db.flush()
    _check_room(db, reader, 1, size)
    now = _now()
    item = AppDataItem(
        public_id="d_" + secrets.token_urlsafe(9),
        collection_id=collection.id,
        project_id=reader.project.id,
        space=reader.space,
        author_user_id=user.id,
        data=data,
        size_bytes=size,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.flush()
    return present(db, reader, [item])[0]


def _own(item: AppDataItem, user: User) -> None:
    if item.author_user_id != user.id:
        raise AppDataError("내가 쓴 항목만 바꿀 수 있어요.", 403, "not_yours")


def _existing(db: Session, reader: Reader, name: str, shared: object) -> AppDataCollection:
    collection = _collection(db, reader, check_collection(name), kind_of(shared))
    if collection is None:
        raise AppDataError(NOT_FOUND, 404, "not_found")
    return collection


def update_item(
    db: Session, reader: Reader, name: str, shared: object, item_id: object, changes: object
) -> dict:
    """Change some fields of one's own item; the others stay."""
    user = _writer(reader)
    if not isinstance(changes, dict):
        raise AppDataError("바꿀 값은 객체({ ... })여야 해요.")
    collection = _existing(db, reader, name, shared)
    _lock_app(db, reader)
    item = _item(db, reader, collection, item_id)
    _own(item, user)
    _note_write(db, reader, user)
    data, size = check_data({**(item.data or {}), **changes})
    _check_room(db, reader, 0, size - item.size_bytes)
    item.data = data
    item.size_bytes = size
    item.updated_at = _now()
    db.flush()
    return present(db, reader, [item])[0]


def remove_item(db: Session, reader: Reader, name: str, shared: object, item_id: object) -> None:
    """The author removes their item; the app's owner may remove any
    shared item of their app (keeping their board tidy)."""
    user = _writer(reader)
    collection = _existing(db, reader, name, shared)
    item = _item(db, reader, collection, item_id)
    if not (item.author_user_id == user.id or (collection.kind == SHARED and reader.is_app_owner)):
        raise AppDataError("내가 쓴 항목만 지울 수 있어요.", 403, "not_yours")
    _note_write(db, reader, user)
    db.delete(item)
    db.flush()


def report_item(db: Session, reader: Reader, name: str, item_id: object, reason: object) -> None:
    """신고 of a shared item → Admin › Content. Once per visitor and item."""
    user = _writer(reader)
    text = " ".join(reason.split()) if isinstance(reason, str) else ""
    if not text:
        raise AppDataError("신고 이유를 적어 주세요.")
    if len(text) > MAX_REASON_CHARS:
        raise AppDataError(f"신고 이유는 {MAX_REASON_CHARS}자까지예요.")
    # Only shared items can be reported — a private one is nobody else's to see.
    collection = _existing(db, reader, name, True)
    item = _item(db, reader, collection, item_id)
    _note_write(db, reader, user)
    already = db.scalar(
        select(AppReport.id).where(
            AppReport.data_item_id == item.id,
            AppReport.reporter_id == user.id,
            AppReport.resolved_at.is_(None),
        )
    )
    if already is not None:
        return
    db.add(
        AppReport(
            project_id=reader.project.id,
            reporter_id=user.id,
            reason=text,
            data_item_id=item.id,
            item_excerpt=excerpt(item),
        )
    )
    db.flush()


def excerpt(item: AppDataItem) -> str:
    text = json.dumps(item.data, ensure_ascii=False)
    return text if len(text) <= EXCERPT_CHARS else text[: EXCERPT_CHARS - 1] + "…"


# ------------------------------------------------------------------ admin


def _close_reports(db: Session, admin: User, item: AppDataItem) -> int:
    rows = list(
        db.scalars(select(AppReport).where(AppReport.data_item_id == item.id, AppReport.resolved_at.is_(None)))
    )
    for row in rows:
        row.resolved_at = _now()
        row.resolved_by = admin.id
    return len(rows)


def _label(db: Session, item: AppDataItem) -> tuple[str, str]:
    project = db.get(BuilderProject, item.project_id)
    collection = db.get(AppDataCollection, item.collection_id)
    return (project.name if project else ""), (collection.name if collection else "")


def admin_hide(db: Session, admin: User, item: AppDataItem, reason: str) -> int:
    """숨기기: gone for every visitor; the row stays (audited). Closes the
    item's open reports."""
    reason = " ".join(reason.split())
    item.hidden_at = _now()
    item.hidden_reason = reason
    closed = _close_reports(db, admin, item)
    app_name, collection = _label(db, item)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.APP_DATA_HIDDEN,
        target_type="app_data_item",
        target_id=item.id,
        target_label=app_name,
        summary=f"앱 '{app_name}'의 공유 데이터({collection})를 숨겼습니다: {reason}",
        detail={"project_id": item.project_id, "collection": collection, "reason": reason, "excerpt": excerpt(item)},
    )
    return closed


def admin_delete(db: Session, admin: User, item: AppDataItem, reason: str) -> int:
    """지우기: the item is deleted for good (audited, with an excerpt of
    what it said). Closes the item's open reports, which keep their excerpt."""
    reason = " ".join(reason.split())
    closed = _close_reports(db, admin, item)
    app_name, collection = _label(db, item)
    audit.record(
        db,
        actor=admin,
        action=AuditAction.APP_DATA_DELETED,
        target_type="app_data_item",
        target_id=item.id,
        target_label=app_name,
        summary=f"앱 '{app_name}'의 공유 데이터({collection})를 지웠습니다: {reason}",
        detail={"project_id": item.project_id, "collection": collection, "reason": reason, "excerpt": excerpt(item)},
    )
    db.delete(item)
    return closed


def app_usage(db: Session, project: BuilderProject) -> dict:
    """For the admin: how much the live app holds."""
    count, size = _usage(db, Reader(project=project, space="app", user=None))
    return {"items": count, "bytes": size}
