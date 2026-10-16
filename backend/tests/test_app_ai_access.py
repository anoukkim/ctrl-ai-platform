"""app-ai-access — how an app's AI is opened to other members.

The owner's decision (2026-10-16): the maker chooses 데모만 or 전체 기능 at
게시 (changeable later); a visitor has a 데모 switch in the shell; the
관리자 keeps 기능 상자 멈추기. 데모 = no call and 0원: the server refuses
with code "demo" before anything is prepared or charged. Mock Claude
throughout; the money proof is the ledger staying empty.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import import_example_apps as cli
from app.models import BuilderProject, UsageEvent, User
from app.services import app_ai_access, app_publish, app_runtime, builder_versions
from tests.conftest import DEV_PASSWORD, MEMBER_PASSWORD
from tests.test_app_platform_p2 import config, headers, shop, sign_in  # noqa: F401 — fixtures
from tests.test_example_apps import settings  # noqa: F401 — fixture


def login(client: TestClient, user: User, password: str) -> None:
    """`client` and `other_client` share one TestClient — the last login wins."""
    assert client.post("/api/auth/login", json={"username": user.username, "password": password}).status_code == 200

AI_FILES = {
    "index.html": "<!doctype html><head><title>t</title></head><body><button id=go>물어보기</button></body>",
    "app.js": "document.getElementById('go').onclick = () => ctrlai.ai.ask({ prompt: '안녕' });",
}
PLAIN_FILES = {"index.html": "<!doctype html><head><title>t</title></head><body>hi</body>"}


def own_project(db: Session, owner: User, files: dict[str, str], name: str = "챗봇") -> BuilderProject:
    project = BuilderProject(owner_user_id=owner.id, name=name, description="")
    db.add(project)
    db.flush()
    builder_versions.replace_files(db, project, files)
    builder_versions.snapshot(db, project, "만들기", files)
    db.commit()
    return project


# ------------------------------------------------------------ the flag


def test_uses_ai_looks_at_pages_and_scripts_only() -> None:
    assert app_ai_access.uses_ai(AI_FILES) is True
    assert app_ai_access.uses_ai(PLAIN_FILES) is False
    # A README that merely mentions the call does not make an AI app.
    assert app_ai_access.uses_ai({"README.md": "ctrlai.ai.ask()를 쓰세요", "index.html": "<p>hi</p>"}) is False
    # Through an alias, as the showcases do.
    assert app_ai_access.uses_ai({"js/a.js": "const sdk = window.ctrlai; sdk.ai.estimate({ prompt: 'x' })"}) is True
    assert app_ai_access.uses_ai({"js/a.js": "const ai = window.ctrlai.ai; // not called"}) is False
    # The version remembers it; the migration fills the same flag for old rows.
    assert app_ai_access.uses_ai([["index.html", "<script>ctrlai.ai.stream({})</script>"]]) is True


def test_a_version_carries_the_flag_and_the_dialog_asks_only_for_ai_apps(
    client: TestClient, db_session: Session, dev_user: User, budgeted, config  # noqa: F811
) -> None:
    ai_app = own_project(db_session, dev_user, AI_FILES)
    plain = own_project(db_session, dev_user, PLAIN_FILES, "메모장")
    assert builder_versions.latest(db_session, ai_app).uses_ai is True
    assert builder_versions.latest(db_session, plain).uses_ai is False

    asked = client.post(f"/api/builder/projects/{ai_app.id}/publish-summary", json={}).json()
    assert asked["uses_ai"] is True and asked["ai_access"] == "demo"
    assert client.post(f"/api/builder/projects/{plain.id}/publish-summary", json={}).json()["uses_ai"] is False


# ------------------------------------------------------------ the maker's choice


def test_publish_records_the_choice_the_listing_shows_it_and_demo_is_the_default(
    client: TestClient, db_session: Session, dev_user: User, budgeted, config  # noqa: F811
) -> None:
    project = own_project(db_session, dev_user, AI_FILES)
    body = {"description": "물어보면 답해요."}

    # No answer → 데모만, the safe default.
    first = client.post(f"/api/builder/projects/{project.id}/publish", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["ai_access"] == "demo" and first.json()["published_uses_ai"] is True
    db_session.refresh(project)
    listing = client.get(f"/api/apps/{project.app_slug}").json()
    assert listing["uses_ai"] is True and listing["ai_access"] == "demo"

    # 전체 기능 at the next 게시; a later 게시 without an answer keeps it.
    second = client.post(f"/api/builder/projects/{project.id}/publish", json={**body, "ai_access": "full"})
    assert second.status_code == 200 and second.json()["ai_access"] == "full"
    third = client.post(f"/api/builder/projects/{project.id}/publish", json=body)
    assert third.json()["ai_access"] == "full"
    assert client.get(f"/api/apps/{project.app_slug}").json()["ai_access"] == "full"

    # Anything else is refused by the schema.
    assert client.post(f"/api/builder/projects/{project.id}/publish", json={**body, "ai_access": "all"}).status_code == 422


def test_the_owner_flips_the_switch_any_time_and_nobody_else_can(
    client: TestClient, other_client: TestClient, db_session: Session, shop: BuilderProject, budgeted,  # noqa: F811
    dev_user: User, other_user: User,
) -> None:
    # `shop` belongs to other_user; the dev user is a visitor who signed in
    # to the app (the app's own cookie stays whoever the site session is).
    login(client, dev_user, DEV_PASSWORD)
    sign_in(client, shop)
    login(other_client, other_user, MEMBER_PASSWORD)
    owner = other_client.post(f"/api/builder/projects/{shop.id}/ai-access", json={"ai_access": "demo"})
    assert owner.status_code == 200 and owner.json()["ai_access"] == "demo"
    assert client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"}).status_code == 403

    back = other_client.post(f"/api/builder/projects/{shop.id}/ai-access", json={"ai_access": "full"})
    assert back.status_code == 200 and back.json()["ai_access"] == "full"
    answer = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"})
    assert answer.status_code == 200, answer.text
    assert other_client.post(f"/api/builder/projects/{shop.id}/ai-access", json={"ai_access": "off"}).status_code == 422


def test_a_stranger_cannot_touch_the_switch(client: TestClient, db_session: Session, shop: BuilderProject) -> None:  # noqa: F811
    # `client` is the dev user — not the owner of `shop`.
    assert client.post(f"/api/builder/projects/{shop.id}/ai-access", json={"ai_access": "full"}).status_code in (403, 404)
    db_session.refresh(shop)
    assert shop.ai_access == "full"


# ------------------------------------------------------------ 데모 = 0원


def test_in_demo_every_visitor_call_is_refused_before_any_charge(
    client: TestClient, db_session: Session, shop: BuilderProject, budgeted  # noqa: F811
) -> None:
    shop.ai_access = "demo"
    db_session.commit()
    sign_in(client, shop)

    info = client.get("/_ctrlai/v1/app", headers=headers(shop)).json()
    assert info["ai"] == {"usesAi": False, "access": "demo"}

    asked = client.post("/_ctrlai/v1/ai/ask", headers=headers(shop), json={"prompt": "안녕"})
    assert asked.status_code == 403
    assert asked.json()["detail"] == {"message": app_ai_access.DEMO_ONLY, "code": "demo"}
    streamed = client.post("/_ctrlai/v1/ai/stream", headers=headers(shop), json={"prompt": "안녕"})
    assert streamed.status_code == 403 and streamed.json()["detail"]["code"] == "demo"
    # Pricing stays free and open — a button can still say what live would cost.
    assert client.post("/_ctrlai/v1/ai/estimate", headers=headers(shop), json={"prompt": "안녕"}).status_code == 200

    # Nothing moved: no ledger row, the wallet untouched.
    assert db_session.query(UsageEvent).count() == 0
    db_session.refresh(budgeted)
    assert budgeted.consumed_krw == 0


def test_the_makers_preview_is_never_limited(
    client: TestClient, db_session: Session, dev_user: User, config  # noqa: F811
) -> None:
    project = own_project(db_session, dev_user, AI_FILES)
    app_runtime.write_draft(db_session, config, project, AI_FILES)
    db_session.commit()
    assert project.ai_access == "demo"
    info = client.get("/_ctrlai/v1/app", headers={"X-CtrlAI-App": project.draft_slug, "Sec-Fetch-Site": "same-origin"}).json()
    assert info["mode"] == "preview" and info["ai"] == {"usesAi": True, "access": "full"}


# ------------------------------------------------------------ the shell, the SDK, the examples


def test_the_shell_and_the_sdk_carry_the_switch(anon_client: TestClient) -> None:
    shell = anon_client.get("/_ctrlai/shell.js").text
    sdk = anon_client.get("/_ctrlai/sdk.js").text
    # The shell refuses locally in 데모 — before sign-in, before any request.
    assert 'error.code = "demo"' in shell and 'case "ai.mode":' in shell and 'id = "ctrlai-ai"' in shell
    assert "실제 AI 켜기" in shell and "데모로 보기" in shell
    assert "mode: function" in sdk and '"ctrlai:ai-mode"' in sdk and 'version: "6"' in sdk
    # Outside CTRL+AI everything is a demo.
    assert 'if (type === "ai.mode") return "demo";' in sdk


def test_the_club_s_showcases_publish_as_full_and_are_known_to_use_ai(
    db_session: Session, dev_user: User, settings  # noqa: F811
) -> None:
    cli.import_examples(db_session, dev_user, settings)
    db_session.commit()
    projects = db_session.query(BuilderProject).filter_by(owner_user_id=dev_user.id).all()
    assert len(projects) == 3
    for project in projects:
        assert project.ai_access == "full" and project.published_uses_ai is True, project.name


def test_the_builder_prompt_and_the_examples_know_the_demo_code() -> None:
    from app.services.claude_provider import _SDK_RULES

    assert '"demo"' in _SDK_RULES and "ctrlai.ai.mode()" in _SDK_RULES
    for example in cli.EXAMPLES:
        code = "\n".join(c for path, c in cli.example_files(example).items() if path.endswith(".js"))
        assert 'error.code === "demo"' in code and "ai.mode" in code, example.folder


def test_publish_service_refuses_a_bad_setting(db_session: Session, dev_user: User, config) -> None:  # noqa: F811
    import pytest

    project = own_project(db_session, dev_user, AI_FILES)
    with pytest.raises(app_publish.PublishError):
        app_publish.publish(db_session, config, project, description="x", note="", ai_access="everyone")
