"""`ctrlai.json` — an app's manifest (app-platform P4).

The one thing it holds today is the app's `ctrlai.db` **collections**:

    {
      "db": [
        { "name": "posts", "shared": true },
        { "name": "notes" }
      ]
    }

Why it exists (security review of P3, 2026-10-16): a collection used to
come into being on anyone's first write, so any consented member could
make twenty junk lists and leave an app with no room for its own. Now a
collection exists because the **app's owner** said so — in this file,
read whenever the app's files are written to the runtime (the Builder's
미리보기 and 게시 each get their own space), or by the owner's own first
save from inside the app. A visitor's write to a list that does not
exist is refused (`no_collection`).

The file is one of the app's own files: it is served on the apps origin
like the rest (names only — there is nothing secret in it), it ships in
the ZIP, and a project's own Claude can read it. An entry taken out of
the file does not delete the list or its data; that stays until an admin
or the owner removes the items.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AppDataCollection, BuilderProject

MANIFEST_FILE = "ctrlai.json"
logger = logging.getLogger(__name__)


class ManifestError(Exception):
    """A Korean sentence naming what is wrong with ctrlai.json."""


@dataclass(frozen=True)
class Collection:
    name: str
    kind: str  # "private" | "shared"


def parse(files: dict[str, str]) -> list[Collection]:
    """The collections ctrlai.json declares — `[]` without the file.
    `ManifestError` when the file is there but wrong."""
    text = files.get(MANIFEST_FILE)
    if text is None:
        return []
    from app.services import app_data  # noqa: PLC0415 — avoids a cycle at import time

    try:
        data = json.loads(text)
    except ValueError as error:
        raise ManifestError(f"{MANIFEST_FILE}이 올바른 JSON이 아니에요: {error.msg}") from error
    if not isinstance(data, dict):
        raise ManifestError(f"{MANIFEST_FILE}은 객체({{ ... }})여야 해요.")
    entries = data.get("db", [])
    if not isinstance(entries, list):
        raise ManifestError(f'{MANIFEST_FILE}의 "db"는 목록([ ... ])이어야 해요.')
    if len(entries) > app_data.MAX_COLLECTIONS:
        raise ManifestError(f"{MANIFEST_FILE}에는 목록을 {app_data.MAX_COLLECTIONS}개까지 적을 수 있어요.")
    out: list[Collection] = []
    seen: set[tuple[str, str]] = set()
    for index, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            raise ManifestError(f'{MANIFEST_FILE}의 "db" {index}번째 항목은 {{ "name": ..., "shared": ... }} 모양이어야 해요.')
        try:
            name = app_data.check_collection(entry.get("name"))
        except app_data.AppDataError as error:
            raise ManifestError(f'{MANIFEST_FILE}의 "db" {index}번째 항목: {error}') from error
        shared = entry.get("shared", False)
        if not isinstance(shared, bool):
            raise ManifestError(f'{MANIFEST_FILE}의 "{name}": "shared"는 true 또는 false여야 해요.')
        kind = app_data.kind_of(shared)
        if (name, kind) in seen:
            raise ManifestError(f'{MANIFEST_FILE}에 "{name}"({"공유" if shared else "개인"})이 두 번 있어요.')
        seen.add((name, kind))
        out.append(Collection(name, kind))
    return out


def declare(db: Session, project: BuilderProject, space: str, files: dict[str, str]) -> int:
    """Make every collection ctrlai.json names exist in `space`; return how
    many were new. Lists already there — declared earlier, or made by the
    owner's first save — are left exactly as they are."""
    wanted = parse(files)
    if not wanted:
        return 0
    from app.services import app_data  # noqa: PLC0415

    existing = {
        (row.name, row.kind)
        for row in db.scalars(
            select(AppDataCollection).where(
                AppDataCollection.project_id == project.id, AppDataCollection.space == space
            )
        )
    }
    added = 0
    for collection in wanted:
        if (collection.name, collection.kind) in existing:
            continue
        # The app's cap counts lists the owner made by hand too; past it,
        # the rest of the file waits until some are removed — said in the
        # log, since the file itself passed every check.
        if len(existing) + added >= app_data.MAX_COLLECTIONS:
            logger.warning(
                "project %s: ctrlai.json names more lists than the cap leaves room for; '%s' (%s) not made",
                project.id, collection.name, collection.kind,
            )
            continue
        # Another writer (a staged generation finishing a file while the
        # maker presses 미리보기 갱신, or the owner's own first save) may
        # make the same list first: a savepoint keeps that from being an
        # IntegrityError that fails the whole write.
        try:
            with db.begin_nested():
                db.add(
                    AppDataCollection(project_id=project.id, space=space, name=collection.name, kind=collection.kind)
                )
                db.flush()
        except IntegrityError:
            continue
        added += 1
    return added
