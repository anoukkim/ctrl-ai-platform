"""app-platform P4 — ctrlai.json, the Builder knowing the SDK, templates,
the preview's own label.

Collections (security review of P3): a list exists because the app's
owner declared it in `ctrlai.json` or saved into it first; a visitor's
save into a list that does not exist is refused.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AppDataCollection, BuilderProject, User
from app.services import app_manifest, app_publish, app_runtime, builder_files, builder_versions
from tests.test_app_platform_p2 import config, headers, shop, sign_in  # noqa: F401 — fixtures
from tests.test_app_platform_p3 import call, save, visitor_b  # noqa: F401 — fixtures

pytestmark = pytest.mark.usefixtures("config")


def manifest(*entries: dict) -> str:
    return json.dumps({"db": list(entries)})


def collections(db: Session, project: BuilderProject, space: str) -> set[tuple[str, str]]:
    rows = db.query(AppDataCollection).filter_by(project_id=project.id, space=space).all()
    return {(row.name, row.kind) for row in rows}


# ------------------------------------------------------------ ctrlai.json


def test_the_manifest_is_read_and_a_wrong_one_is_refused() -> None:
    assert app_manifest.parse({"index.html": ""}) == []
    assert app_manifest.parse({"ctrlai.json": "{}"}) == []
    parsed = app_manifest.parse({"ctrlai.json": manifest({"name": "posts", "shared": True}, {"name": "notes"})})
    assert [(c.name, c.kind) for c in parsed] == [("posts", "shared"), ("notes", "private")]

    for text, reason in [
        ("{", "올바른 JSON"),
        ("[]", "객체"),
        ('{"db": {}}', "목록"),
        ('{"db": [1]}', "모양"),
        ('{"db": [{"name": "bad name!"}]}', "목록 이름"),
        ('{"db": [{"name": "a", "shared": "yes"}]}', "true 또는 false"),
        ('{"db": [{"name": "a"}, {"name": "a", "shared": false}]}', "두 번"),
        (json.dumps({"db": [{"name": f"c{i}"} for i in range(21)]}), "20개"),
    ]:
        with pytest.raises(app_manifest.ManifestError, match=reason):
            app_manifest.parse({"ctrlai.json": text})

    # The Builder's own file check refuses it the same way (the member sees why).
    with pytest.raises(builder_files.FileRuleError, match="올바른 JSON"):
        builder_files.apply_writes({"index.html": "<p>"}, [("ctrlai.json", "{")])
    # The same name as private and shared is two lists, and that is allowed.
    builder_files.apply_writes(
        {"index.html": "<p>"}, [("ctrlai.json", manifest({"name": "votes"}, {"name": "votes", "shared": True}))]
    )


def test_writing_the_files_declares_the_lists_in_that_space(
    db_session: Session, other_user: User, config
) -> None:
    project = BuilderProject(owner_user_id=other_user.id, name="게시판", description="")
    db_session.add(project)
    db_session.flush()
    files = {"index.html": "<!doctype html><head></head>", "ctrlai.json": manifest({"name": "posts", "shared": True})}

    app_runtime.write_draft(db_session, config, project, files)
    assert collections(db_session, project, "preview") == {("posts", "shared")}
    assert collections(db_session, project, "app") == set()

    # Publishing declares them for the live app; a second write adds only what is new.
    builder_versions.replace_files(db_session, project, files)
    builder_versions.snapshot(db_session, project, "만들기", files)
    app_publish.publish(db_session, config, project, description="게시판", note="")
    assert collections(db_session, project, "app") == {("posts", "shared")}
    more = dict(files, **{"ctrlai.json": manifest({"name": "posts", "shared": True}, {"name": "drafts"})})
    app_runtime.write_draft(db_session, config, project, more)
    assert collections(db_session, project, "preview") == {("posts", "shared"), ("drafts", "private")}
    # Taking an entry out of the file keeps the list (and whatever it holds).
    app_runtime.write_draft(db_session, config, project, files)
    assert collections(db_session, project, "preview") == {("posts", "shared"), ("drafts", "private")}


def test_a_visitor_cannot_make_a_list_but_the_owner_can(
    client: TestClient, visitor_b: TestClient, shop: BuilderProject
) -> None:
    sign_in(client, shop)  # the development user: a visitor of other_user's app
    sign_in(visitor_b, shop)  # other_user: the owner

    refused = call(client, shop, "save", collection="junk", data={"n": 1}, shared=True)
    assert refused.status_code == 404 and refused.json()["detail"]["code"] == "no_collection"
    assert "ctrlai.json" in refused.json()["detail"]["message"]
    assert call(client, shop, "save", collection="junk", data={"n": 1}).status_code == 404
    # Reads of a list that is not there stay as they were: empty, not an error.
    assert call(client, shop, "list", collection="junk", shared=True).json()["items"] == []

    # The owner's first save makes it; from then on visitors write into it.
    assert call(visitor_b, shop, "save", collection="junk", data={"n": 1}, shared=True).status_code == 200
    assert call(client, shop, "save", collection="junk", data={"n": 2}, shared=True).status_code == 200
    assert call(client, shop, "count", collection="junk", shared=True).json()["count"] == 2
    # Declared lists work for a visitor from the start (the fixture's ctrlai.json).
    assert call(client, shop, "save", collection="posts", data={"text": "안녕"}, shared=True).status_code == 200


def test_the_sdk_names_the_manifest_and_the_refusal() -> None:
    from app.services import app_shell

    sdk = app_shell.static_file("sdk.js")
    assert "ctrlai.json" in sdk and "no_collection" in sdk
