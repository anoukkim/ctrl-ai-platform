"""app-platform P3 — `ctrlai.db`, the per-app database.

The visitor is the development user; `other_user` owns the app. Shared
collections are readable signed out; everything else needs the app's own
cookie (never the site's session) and the "data" consent. Apps and
visitors cannot reach each other's items; quotas and the write rate are
held; a deleted or unpublished app answers 404; the Builder's 미리보기 has
a space of its own.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.models import AppConsent, AppDataItem, AppReport, AuditLog, BuilderProject, User
from app.services import app_data, app_publish, app_runtime, builder_versions
from tests.conftest import JSON_HEADERS, MEMBER_PASSWORD
from tests.test_app_platform_p2 import config, headers, shop, sign_in  # noqa: F401 — fixtures

pytestmark = pytest.mark.usefixtures("config")


@pytest.fixture
def visitor_b(anon_client: TestClient, other_user: User) -> TestClient:
    """A second browser, signed in on the site as `other_user` (the app's
    owner). `client` and `other_client` share one cookie jar in conftest,
    which would blur exactly what these tests prove. (`anon_client` is
    what points the app at the test database.)"""
    with TestClient(app, headers=JSON_HEADERS) as browser:
        login = browser.post("/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD})
        assert login.status_code == 200, login.text
        yield browser


@pytest.fixture
def stranger(anon_client: TestClient) -> TestClient:
    """A browser with no cookies at all."""
    with TestClient(app, headers=JSON_HEADERS) as browser:
        yield browser


def publish(db: Session, owner: User, name: str, settings) -> BuilderProject:
    project = BuilderProject(owner_user_id=owner.id, name=name, description="")
    db.add(project)
    db.flush()
    files = {"index.html": "<!doctype html><head><title>t</title></head>"}
    builder_versions.replace_files(db, project, files)
    builder_versions.snapshot(db, project, "만들기", files)
    app_publish.publish(db, settings, project, description=name, note="")
    db.commit()
    return project


def call(client: TestClient, project: BuilderProject, op: str, **body):
    return client.post(f"/_ctrlai/v1/data/{op}", headers=headers(project), json=body)


def save(client: TestClient, project: BuilderProject, collection: str, data: dict, **extra) -> dict:
    response = call(client, project, "save", collection=collection, data=data, **extra)
    assert response.status_code == 200, response.text
    return response.json()["item"]


# ---------------------------------------------------------- who sees what


def test_writes_need_the_app_cookie_and_reads_of_shared_work_signed_out(
    client: TestClient, stranger: TestClient, shop: BuilderProject
) -> None:
    # The site's session (client is signed in on ctrlai.my) counts for nothing.
    refused = call(client, shop, "save", collection="posts", data={"text": "안녕"}, shared=True)
    assert refused.status_code == 401

    sign_in(client, shop)
    item = save(client, shop, "posts", {"text": "안녕"}, shared=True)
    assert set(item) == {"id", "data", "createdAt", "updatedAt", "mine", "canDelete", "author"}
    assert item["id"].startswith("d_") and item["mine"] is True and item["canDelete"] is True
    assert item["author"]["displayName"] == "Ctrl AI Developer" and item["author"]["appUserId"].startswith("u_")
    assert "email" not in json.dumps(item) and "username" not in json.dumps(item)

    # Signed out: shared is readable, nothing is writable.
    listed = call(stranger, shop, "list", collection="posts")
    assert listed.status_code == 200 and [row["data"] for row in listed.json()["items"]] == [{"text": "안녕"}]
    assert listed.json()["items"][0]["mine"] is False and listed.json()["items"][0]["canDelete"] is False
    assert call(stranger, shop, "count", collection="posts").json()["count"] == 1
    assert call(stranger, shop, "get", collection="posts", id=item["id"]).json()["item"]["data"] == {"text": "안녕"}
    assert call(stranger, shop, "update", collection="posts", id=item["id"], data={"text": "x"}).status_code == 401
    assert call(stranger, shop, "remove", collection="posts", id=item["id"]).status_code == 401


def test_private_collections_are_per_visitor_and_hidden_signed_out(
    client: TestClient, visitor_b: TestClient, stranger: TestClient, shop: BuilderProject
) -> None:
    sign_in(client, shop)
    sign_in(visitor_b, shop)
    mine = save(client, shop, "diary", {"day": 1})
    save(visitor_b, shop, "diary", {"day": 2})

    assert [row["data"] for row in call(client, shop, "list", collection="diary").json()["items"]] == [{"day": 1}]
    assert [row["data"] for row in call(visitor_b, shop, "list", collection="diary").json()["items"]] == [{"day": 2}]
    assert call(visitor_b, shop, "get", collection="diary", id=mine["id"]).json()["item"] is None
    assert call(visitor_b, shop, "update", collection="diary", id=mine["id"], data={"day": 9}).status_code == 404
    assert call(visitor_b, shop, "remove", collection="diary", id=mine["id"]).status_code == 404

    signed_out = call(stranger, shop, "list", collection="diary")
    assert signed_out.status_code == 401 and signed_out.json()["detail"]["code"] == "login_required"
    assert call(stranger, shop, "count", collection="diary").status_code == 401
    # A collection nobody made yet is simply empty.
    assert call(stranger, shop, "list", collection="nothing").json() == {"items": [], "nextCursor": None}


def test_the_kind_is_fixed_by_the_first_save(client: TestClient, shop: BuilderProject) -> None:
    sign_in(client, shop)
    save(client, shop, "votes", {"v": 1}, shared=True)
    save(client, shop, "votes", {"v": 2})  # no kind named: fine
    save(client, shop, "votes", {"v": 3}, shared=True)
    clash = call(client, shop, "save", collection="votes", data={"v": 4}, shared=False)
    assert clash.status_code == 409 and clash.json()["detail"]["code"] == "kind"
    assert call(client, shop, "count", collection="votes").json()["count"] == 3


def test_apps_cannot_reach_each_other_s_data(
    client: TestClient, db_session: Session, shop: BuilderProject, other_user: User, config
) -> None:
    second = publish(db_session, other_user, "다른 앱", config)
    sign_in(client, shop)
    sign_in(client, second)
    item = save(client, shop, "posts", {"text": "A"}, shared=True)
    assert call(client, second, "list", collection="posts").json()["items"] == []
    assert call(client, second, "get", collection="posts", id=item["id"]).json()["item"] is None
    # Even naming the right id: another app's collection does not hold it.
    save(client, second, "posts", {"text": "B"}, shared=True)
    assert call(client, second, "remove", collection="posts", id=item["id"]).status_code == 404
    assert call(client, shop, "count", collection="posts").json()["count"] == 1


def test_only_the_author_changes_an_item_and_the_app_owner_may_delete_shared_ones(
    client: TestClient, visitor_b: TestClient, shop: BuilderProject
) -> None:
    sign_in(client, shop)
    sign_in(visitor_b, shop)  # other_user owns the app
    item = save(client, shop, "board", {"text": "원본", "likes": 0}, shared=True)

    changed = call(client, shop, "update", collection="board", id=item["id"], data={"likes": 1})
    assert changed.status_code == 200 and changed.json()["item"]["data"] == {"text": "원본", "likes": 1}
    not_yours = call(visitor_b, shop, "update", collection="board", id=item["id"], data={"likes": 2})
    assert not_yours.status_code == 403 and not_yours.json()["detail"]["code"] == "not_yours"

    seen_by_owner = call(visitor_b, shop, "list", collection="board").json()["items"][0]
    assert seen_by_owner["mine"] is False and seen_by_owner["canDelete"] is True
    assert call(visitor_b, shop, "remove", collection="board", id=item["id"]).status_code == 200
    assert call(client, shop, "count", collection="board").json()["count"] == 0

    # … but not a private item of a visitor, which the owner cannot even see.
    private = save(client, shop, "notes", {"text": "나만"})
    assert call(visitor_b, shop, "remove", collection="notes", id=private["id"]).status_code == 404


def test_a_consent_from_before_p3_must_be_renewed_for_writes(
    client: TestClient, db_session: Session, shop: BuilderProject
) -> None:
    sign_in(client, shop)
    consent = db_session.query(AppConsent).one()
    consent.scopes = ["profile", "ai"]
    db_session.commit()
    refused = call(client, shop, "save", collection="posts", data={"a": 1}, shared=True)
    assert refused.status_code == 403 and refused.json()["detail"]["code"] == "consent_required"
    # Reads still work.
    assert call(client, shop, "list", collection="posts").status_code == 200
    # Allowing again (the shell reopens the consent window) renews the scopes.
    sign_in(client, shop)
    assert db_session.query(AppConsent).one().scopes == ["profile", "ai", "data"]
    assert call(client, shop, "save", collection="posts", data={"a": 1}, shared=True).status_code == 200


# ------------------------------------------------------------ the queries


def test_list_filters_sorts_and_pages(client: TestClient, shop: BuilderProject) -> None:
    sign_in(client, shop)
    for index, (name, score, done) in enumerate([("가", 30, True), ("나", 10, False), ("다", 20, True), ("라", 20, None)]):
        data = {"name": name, "score": score}
        if done is not None:
            data["done"] = done
        save(client, shop, "scores", data, shared=True)

    newest_first = call(client, shop, "list", collection="scores").json()["items"]
    assert [row["data"]["name"] for row in newest_first] == ["라", "다", "나", "가"]
    by_score = call(client, shop, "list", collection="scores", orderBy="score", order="desc").json()["items"]
    assert [row["data"]["name"] for row in by_score] == ["가", "다", "라", "나"]
    done = call(client, shop, "list", collection="scores", where={"done": True}).json()["items"]
    assert [row["data"]["name"] for row in done] == ["다", "가"]
    # 1 is not true: equality keeps the type.
    assert call(client, shop, "list", collection="scores", where={"done": 1}).json()["items"] == []
    assert call(client, shop, "count", collection="scores", where={"score": 20}).json()["count"] == 2

    first = call(client, shop, "list", collection="scores", limit=3, orderBy="name").json()
    assert [row["data"]["name"] for row in first["items"]] == ["가", "나", "다"] and first["nextCursor"] == "c3"
    rest = call(client, shop, "list", collection="scores", limit=3, orderBy="name", cursor=first["nextCursor"]).json()
    assert [row["data"]["name"] for row in rest["items"]] == ["라"] and rest["nextCursor"] is None

    mine = call(client, shop, "list", collection="scores", mine=True).json()["items"]
    assert len(mine) == 4

    assert call(client, shop, "list", collection="scores", limit=101).status_code == 400
    assert call(client, shop, "list", collection="scores", orderBy="a b").status_code == 400
    assert call(client, shop, "list", collection="scores", where={"x": {"nested": 1}}).status_code == 400
    assert call(client, shop, "list", collection="bad name!").status_code == 400
    assert call(client, shop, "list", collection="scores", cursor="zzz").status_code == 400


# --------------------------------------------------------------- limits


def test_item_size_app_quota_and_the_write_rate(
    client: TestClient, shop: BuilderProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client, shop)
    too_big = call(client, shop, "save", collection="big", data={"text": "가" * 2000}, shared=True)
    assert too_big.status_code == 413 and too_big.json()["detail"]["code"] == "too_large"
    not_object = call(client, shop, "save", collection="big", data=["a"], shared=True)
    assert not_object.status_code == 422

    monkeypatch.setattr(app_data, "MAX_APP_ITEMS", 2)
    save(client, shop, "few", {"n": 1})
    save(client, shop, "few", {"n": 2})
    full = call(client, shop, "save", collection="few", data={"n": 3})
    assert full.status_code == 409 and full.json()["detail"]["code"] == "full"
    monkeypatch.setattr(app_data, "MAX_APP_ITEMS", 2000)

    monkeypatch.setattr(app_data, "MAX_APP_BYTES", 40)
    bytes_full = call(client, shop, "save", collection="few2", data={"text": "가나다라마바사아자차"})
    assert bytes_full.status_code == 409 and "5MB" in bytes_full.json()["detail"]["message"]
    monkeypatch.setattr(app_data, "MAX_APP_BYTES", 5 * 1024 * 1024)

    # A refused save leaves no collection behind ("few2" above): one so far.
    monkeypatch.setattr(app_data, "MAX_COLLECTIONS", 1)
    assert call(client, shop, "save", collection="second", data={"n": 1}).status_code == 409

    # A refused write is rolled back and does not count: two so far this minute.
    monkeypatch.setattr(app_data, "WRITES_PER_MINUTE", 2)
    limited = call(client, shop, "save", collection="few", data={"n": 0})
    assert limited.status_code == 429 and limited.json()["detail"]["code"] == "rate"
    monkeypatch.setattr(app_data, "WRITES_PER_MINUTE", 30)
    assert call(client, shop, "update", collection="few", id=save(client, shop, "few", {"n": 9})["id"], data={"n": 10}).status_code == 200


def test_deleted_unpublished_and_stopped_apps_answer_nothing(
    client: TestClient, db_session: Session, shop: BuilderProject, config
) -> None:
    sign_in(client, shop)
    save(client, shop, "posts", {"a": 1}, shared=True)

    stopped = client.post(f"/api/admin/apps/{shop.id}/sdk", json={"enabled": False, "reason": "확인 중"})
    assert stopped.status_code == 200
    assert call(client, shop, "list", collection="posts").status_code == 403
    client.post(f"/api/admin/apps/{shop.id}/sdk", json={"enabled": True})
    assert call(client, shop, "list", collection="posts").status_code == 200

    app_publish.unpublish(db_session, config, shop)
    db_session.commit()
    assert call(client, shop, "list", collection="posts").status_code == 404


def test_the_preview_has_its_own_space(
    client: TestClient, db_session: Session, shop: BuilderProject, config
) -> None:
    app_runtime.write_draft(db_session, config, shop, {"index.html": "<!doctype html><head></head>"})
    db_session.commit()
    sign_in(client, shop)
    save(client, shop, "posts", {"live": True}, shared=True)
    preview_headers = {"X-CtrlAI-App": shop.draft_slug, "Sec-Fetch-Site": "same-origin"}
    listed = client.post("/_ctrlai/v1/data/list", headers=preview_headers, json={"collection": "posts"})
    assert listed.status_code == 200 and listed.json()["items"] == []


# ---------------------------------------------------- 신고 and the admin


def test_reporting_a_shared_item_reaches_the_admin_who_hides_or_deletes_it(
    client: TestClient, visitor_b: TestClient, stranger: TestClient, db_session: Session, shop: BuilderProject
) -> None:
    sign_in(client, shop)
    sign_in(visitor_b, shop)
    item = save(client, shop, "board", {"text": "이상한 글"}, shared=True)
    private = save(client, shop, "notes", {"text": "나만"})

    assert call(visitor_b, shop, "report", collection="board", id=item["id"], reason="").status_code == 400
    assert call(visitor_b, shop, "report", collection="notes", id=private["id"], reason="x").status_code == 400
    reported = call(visitor_b, shop, "report", collection="board", id=item["id"], reason="욕설이에요")
    assert reported.status_code == 200
    # Once per visitor and item.
    call(visitor_b, shop, "report", collection="board", id=item["id"], reason="또")
    assert db_session.query(AppReport).count() == 1

    queue = client.get("/api/admin/apps/reports").json()
    assert len(queue) == 1 and queue[0]["item_excerpt"] == '{"text": "이상한 글"}' and queue[0]["item_live"] is True
    assert queue[0]["reporter_username"] == "other"

    data = client.get(f"/api/admin/apps/{shop.id}/data").json()
    assert data["items"] == 2 and data["bytes"] > 0
    assert [(row["name"], row["kind"], row["items"]) for row in data["collections"]] == [("board", "shared", 1), ("notes", "private", 1)]
    assert [row["data"] for row in data["shared"]] == [{"text": "이상한 글"}]
    assert data["shared"][0]["open_reports"] == 1 and data["shared"][0]["author_username"] == "dev"
    assert client.get("/api/admin/apps").json()[0]["data_items"] == 2

    hidden_id = data["shared"][0]["id"]
    assert client.post(f"/api/admin/apps/data/{hidden_id}/hide", json={"reason": ""}).status_code == 400
    hidden = client.post(f"/api/admin/apps/data/{hidden_id}/hide", json={"reason": "욕설"})
    assert hidden.status_code == 200 and hidden.json()["reports_closed"] == 1
    assert call(stranger, shop, "list", collection="board").json()["items"] == []
    assert call(client, shop, "get", collection="board", id=item["id"]).json()["item"] is None
    assert client.get("/api/admin/apps/reports").json() == []
    assert client.post(f"/api/admin/apps/data/{hidden_id}/hide", json={"reason": "다시"}).status_code == 404

    again = save(client, shop, "board", {"text": "또 이상한 글"}, shared=True)
    row = db_session.query(AppDataItem).filter_by(public_id=again["id"]).one()
    deleted = client.post(f"/api/admin/apps/data/{row.id}/delete", json={"reason": "광고"})
    assert deleted.status_code == 200
    assert db_session.query(AppDataItem).filter_by(public_id=again["id"]).count() == 0
    actions = [row.action for row in db_session.query(AuditLog).order_by(AuditLog.id)]
    assert actions.count("app_data.hidden") == 1 and actions.count("app_data.deleted") == 1
    detail = db_session.query(AuditLog).filter_by(action="app_data.deleted").one().detail
    assert detail["excerpt"] == '{"text": "또 이상한 글"}' and detail["reason"] == "광고"


def test_the_admin_routes_need_an_admin(visitor_b: TestClient, shop: BuilderProject) -> None:
    assert visitor_b.get(f"/api/admin/apps/{shop.id}/data").status_code == 403
    assert visitor_b.post("/api/admin/apps/data/1/hide", json={"reason": "x"}).status_code == 403


def test_the_shell_and_the_sdk_carry_ctrlai_db() -> None:
    from app.services import app_shell

    sdk = app_shell.static_file("sdk.js")
    shell = app_shell.static_file("shell.js")
    for name in ("save", "list", "get", "update", "remove", "count", "report"):
        assert f"{name}: function" in sdk
    assert 'db: db' in sdk and 'version: "3"' in sdk
    assert '"/v1/data/" + op' in shell and 'error.code === "consent_required"' in shell
