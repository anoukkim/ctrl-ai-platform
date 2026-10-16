"""app-platform P4 — ctrlai.json, the Builder knowing the SDK, templates,
the preview's own label.

Collections (security review of P3): a list exists because the app's
owner declared it in `ctrlai.json` or saved into it first; a visitor's
save into a list that does not exist is refused.
"""

import json
import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AppDataCollection, BuilderProject, User
from app.services import app_manifest, app_publish, app_runtime, builder_files, builder_versions
from tests.test_app_platform_p2 import SHOP_FILES, config, headers, shop, sign_in  # noqa: F401 — fixtures
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


# ---------------------------------------------------------------- templates


def test_every_template_passes_the_file_rules_and_uses_the_sdk_the_right_way() -> None:
    from app.services import builder_templates

    assert [t.key for t in builder_templates.TEMPLATES] == ["ai-chatbot", "poll", "ranking-game", "club-board"]
    for template in builder_templates.TEMPLATES:
        files = builder_templates.files_of(template)
        assert "index.html" in files and "app.js" in files and "style.css" in files
        code = files["app.js"]
        # Signed out or outside CTRL+AI the page still works: a demo path, and
        # a login button rather than a surprise sign-in window.
        assert "window.ctrlai.connected" in code and "데모" in code
        assert "login_required" in code and "login()" in code
        for forbidden in ("alert(", "confirm(", "prompt(", "<script src=\"http", "https://"):
            assert forbidden not in code and forbidden not in files["index.html"], (template.key, forbidden)
        # Every list the code uses is declared, with the same kind (shared) in both.
        used = set(re.findall(r'db\.(?:save|list|get|update|remove|count)\("([a-z]+)"', code))
        declared = {c.name for c in app_manifest.parse(files)}
        assert used == declared, (template.key, used, declared)
        assert all(c.kind == "shared" for c in app_manifest.parse(files))
    chatbot = builder_templates.files_of(builder_templates.get("ai-chatbot"))
    assert "ctrlai.json" not in chatbot and "ai.stream" in chatbot["app.js"] and "최대 200원" in chatbot["app.js"]


def test_a_template_becomes_a_free_project_with_its_lists_declared(
    client: TestClient, db_session: Session, participating, config
) -> None:
    from app.models import UsageEvent

    listed = client.get("/api/builder/templates")
    assert listed.status_code == 200 and [t["key"] for t in listed.json()] == ["ai-chatbot", "poll", "ranking-game", "club-board"]
    assert listed.json()[1]["uses"] == ["공유 데이터", "로그인"]

    made = client.post("/api/builder/projects/from-template", json={"template": "club-board", "name": ""})
    assert made.status_code == 201, made.text
    project = db_session.get(BuilderProject, made.json()["id"])
    assert project.name == "동아리 게시판" and project.draft_slug
    assert project.description == ""  # 게시 pre-fills the blurb from it: the member writes their own
    paths = {f.path for f in project.files}
    assert {"index.html", "style.css", "app.js", "ctrlai.json"} <= paths
    assert db_session.query(UsageEvent).count() == 0
    versions = client.get(f"/api/builder/projects/{project.id}/versions").json()
    assert versions[0]["note"] == "템플릿: 동아리 게시판"
    # The preview can be tried at once: its lists exist in the preview space.
    assert collections(db_session, project, "preview") == {("posts", "shared"), ("comments", "shared")}

    named = client.post("/api/builder/projects/from-template", json={"template": "poll", "name": "점심 투표"})
    assert named.status_code == 201 and named.json()["name"] == "점심 투표"
    assert client.post("/api/builder/projects/from-template", json={"template": "nope"}).status_code == 404


def test_a_member_not_participating_gets_no_template_project(other_client: TestClient, db_session: Session) -> None:
    assert other_client.get("/api/builder/templates").status_code == 200
    assert other_client.post("/api/builder/projects/from-template", json={"template": "poll"}).status_code == 403
    assert db_session.query(BuilderProject).count() == 0


# ------------------------------------------------------ the preview's own label


def sign_in_preview(client: TestClient, project: BuilderProject) -> dict:
    """The consent flow against the working copy's slug (the Builder's 미리보기)."""
    slug = project.draft_slug
    preview = {"X-CtrlAI-App": slug, "Sec-Fetch-Site": "same-origin"}
    start = client.post("/_ctrlai/v1/login/start", headers=preview, json={})
    assert start.status_code == 200, start.text
    state = start.json()["connectUrl"].split("state=")[1]
    info = client.get(f"/api/app-connect/{slug}").json()
    assert info["mode"] == "preview" and info["name"] == project.name
    allowed = client.post(f"/api/app-connect/{slug}", json={"state": state})
    assert allowed.status_code == 200, allowed.text
    query = allowed.json()["redirect_url"].split("?", 1)[1]
    assert client.get(f"/{slug}/_ctrlai/callback?{query}").status_code == 200
    return preview


def test_ai_in_the_preview_is_the_maker_s_own_spend_labelled_apart(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted, dev_user: User, config
) -> None:
    from app.models import UsageEvent
    from app.services import app_ai, app_shell

    app_runtime.write_draft(db_session, config, shop, dict(SHOP_FILES))
    db_session.commit()
    preview = sign_in_preview(client, shop)

    answer = client.post("/_ctrlai/v1/ai/ask", headers=preview, json={"prompt": "안녕?"})
    assert answer.status_code == 200, answer.text
    event = db_session.query(UsageEvent).one()
    assert event.feature == "app_ai_preview" and event.builder_project_id == shop.id and event.user_id == dev_user.id
    assert event.charged_krw == answer.json()["chargedKrw"] > 0
    usage = client.get("/api/usage/me").json()
    assert any(row["label"] == "앱 미리보기 · 영수증 읽기" for row in usage["events"])
    # It counts toward the same day cap and rates as a visitor's use.
    assert app_ai.app_ai_spent_today(db_session, dev_user.id) == event.charged_krw

    with client.stream("POST", "/_ctrlai/v1/ai/stream", headers=preview, json={"prompt": "안녕"}) as response:
        "".join(response.iter_text())
    assert db_session.query(UsageEvent).filter_by(feature="app_ai_preview").count() == 2
    assert "미리보기 사용 · " in app_shell.static_file("shell.js")
