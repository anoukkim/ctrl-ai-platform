"""app-platform P1 — the trusted shell, the SDK and the `/_ctrlai` router.

The browser-level guarantees (an app cannot reach `/_ctrlai` with
credentials, cannot drive another app's shell, a popup opener cannot drive
a shell) are in `frontend/e2e/app-platform.spec.ts`. Here: what the server
sends, to whom, and what it refuses.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import BuilderProject
from app.services import app_publish, app_runtime, app_shell, builder_versions

ROUTES = Path(__file__).resolve().parents[1] / "app" / "api" / "routes" / "app_platform.py"


@pytest.fixture
def config(tmp_path):
    settings = Settings(
        app_env="development",
        apps_dir=str(tmp_path / "apps"),
        apps_base_url="https://apps.ctrlai.my",
        cors_allow_origins="http://localhost:3000",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def published(db_session: Session, dev_user, config) -> BuilderProject:
    project = BuilderProject(owner_user_id=dev_user.id, name='할 일 <b>"앱"</b>', description="")
    db_session.add(project)
    db_session.flush()
    files = {"index.html": "<!doctype html><html><head><title>t</title></head><body></body></html>"}
    builder_versions.replace_files(db_session, project, files)
    builder_versions.snapshot(db_session, project, "만들기", files)
    app_runtime.write_draft(db_session, config, project, files)
    app_publish.publish(db_session, config, project, description="할 일", note="")
    db_session.commit()
    return project


def test_the_scripts_are_served_as_javascript(anon_client: TestClient) -> None:
    for name in ("sdk.js", "shell.js"):
        response = anon_client.get(f"/_ctrlai/{name}")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/javascript")
        assert response.headers["x-content-type-options"] == "nosniff"
    sdk = anon_client.get("/_ctrlai/sdk.js").text
    assert "ctrlai.storage" in sdk and "postMessage(message, shellOrigin)" in sdk


def test_the_shell_of_a_published_app(anon_client: TestClient, published: BuilderProject) -> None:
    response = anon_client.get(f"/_ctrlai/shell/{published.app_slug}")

    assert response.status_code == 200
    page = response.text
    assert '<script src="/_ctrlai/shell.js"></script>' in page
    assert 'data-mode="app"' in page
    # The name is text, never markup.
    assert "<b>" not in page and "&lt;b&gt;" in page
    assert response.headers["content-security-policy"] == app_shell.shell_csp("https://ctrlai.my")
    assert "frame-ancestors https://ctrlai.my" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers


def test_the_shell_has_the_apps_cover_as_its_tab_icon(anon_client: TestClient, published: BuilderProject) -> None:
    """app-tab-icon: the browser tab shows the app's cover — its colour
    from the slug (the same hue as the CtrlAIApps card) and its first
    letter — as an SVG data URL the shell draws; CSP allows `data:` images
    already, so nothing else changes."""
    from urllib.parse import unquote

    page = anon_client.get(f"/_ctrlai/shell/{published.app_slug}").text
    start = page.index('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,')
    href = page[start:].split('href="', 1)[1].split('"', 1)[0]
    svg = unquote(href.removeprefix("data:image/svg+xml,"))
    assert svg.startswith("<svg") and svg.endswith("</svg>")
    assert f"oklch(0.42 0.09 {app_shell.cover_hue(published.app_slug)})" in svg
    assert f">{published.name[0]}</text>" in svg
    # The working copy's shell uses the draft's seed, like the Builder card.
    preview = anon_client.get(f"/_ctrlai/shell/{published.draft_slug}").text
    assert f"oklch(0.42 0.09 {app_shell.cover_hue(published.draft_slug)})" in unquote(preview)
    # The same arithmetic as lib/apps.ts `coverHue` (values computed there).
    assert [app_shell.cover_hue(s) for s in ("abcdefgh23", "hjy5qfvr6t", "zzzzzzzzzz", "3")] == [117, 341, 0, 51]
    # A hostile name cannot break out of the SVG text or the attribute.
    icon = app_shell.favicon('<b onload="x">', "abcdefgh23")
    assert '"' not in icon and "<" not in icon and ">" not in icon
    assert "&lt;" in unquote(icon) and "<b" not in unquote(icon)
    assert ">?</text>" in unquote(app_shell.favicon("   ", "abcdefgh23"))
    assert ">가</text>" in unquote(app_shell.favicon("가계부", "abcdefgh23"))


def test_the_working_copy_has_a_preview_shell(anon_client: TestClient, published: BuilderProject) -> None:
    page = anon_client.get(f"/_ctrlai/shell/{published.draft_slug}").text
    assert 'data-mode="preview"' in page and "미리보기" in page


def test_no_shell_for_unknown_unpublished_or_deleted(
    anon_client: TestClient, db_session: Session, published: BuilderProject, config
) -> None:
    for slug in ("zzzzzzzzzz", "../../etc", "ABCDEFGHJK", "x"):
        assert anon_client.get(f"/_ctrlai/shell/{slug}").status_code == 404
    slug, draft = published.app_slug, published.draft_slug
    app_publish.unpublish(db_session, config, published)
    db_session.commit()
    assert anon_client.get(f"/_ctrlai/shell/{slug}").status_code == 404
    assert anon_client.get(f"/_ctrlai/shell/{draft}").status_code == 200
    from datetime import datetime, timezone

    published.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    assert anon_client.get(f"/_ctrlai/shell/{draft}").status_code == 404


def test_the_v1_guard(anon_client: TestClient, published: BuilderProject) -> None:
    url = "/_ctrlai/v1/app"
    assert anon_client.get(url).status_code == 404  # no X-CtrlAI-App
    assert anon_client.get(url, headers={"X-CtrlAI-App": "zzzzzzzzzz"}).status_code == 404
    cross = anon_client.get(url, headers={"X-CtrlAI-App": published.app_slug, "Sec-Fetch-Site": "same-site"})
    assert cross.status_code == 403
    ok = anon_client.get(url, headers={"X-CtrlAI-App": published.app_slug, "Sec-Fetch-Site": "same-origin"})
    assert ok.status_code == 200
    body = ok.json()
    assert (body["name"], body["mode"], body["sdk"], body["signedIn"]) == (published.name, "app", "on", False)


def test_the_router_never_reads_the_main_session(client: TestClient, published: BuilderProject) -> None:
    """Signed in on the site or not, the answer is the same: these routes
    do not know the site's session — by construction."""
    source = ROUTES.read_text(encoding="utf-8")
    assert "get_current_user" not in source.split('"""', 2)[2]
    assert "session_cookie_name" not in source and "require_admin" not in source
    headers = {"X-CtrlAI-App": published.app_slug}
    assert client.get("/_ctrlai/v1/app", headers=headers).json()["mode"] == "app"


def test_the_platform_is_not_under_the_site_api(anon_client: TestClient) -> None:
    assert anon_client.get("/api/_ctrlai/sdk.js").status_code == 404
    assert anon_client.get("/_ctrlai/sdk.js").status_code == 200


def test_every_app_page_loads_the_sdk_first(published: BuilderProject, config) -> None:
    root = app_runtime.apps_root(config)
    for slug in (published.app_slug, published.draft_slug):
        page = (root / slug / "index.html").read_text(encoding="utf-8")
        assert page.index(app_runtime.SDK_TAG) < page.index("<title>")


def test_the_frame_ancestors_follow_the_apps_origin(config) -> None:
    assert app_shell.site_origins(config) == ["https://ctrlai.my"]
    assert app_shell.app_files_ancestors(config) == "https://apps.ctrlai.my https://ctrlai.my"
    local = Settings(app_env="development", apps_base_url="http://localhost:8300",
                     cors_allow_origins="http://localhost:3000")
    assert app_shell.site_origins(local) == ["http://localhost:3000"]


def test_the_shell_and_the_sdk_agree_on_the_rules() -> None:
    """The shell accepts only its own frame's messages, from an opaque
    origin; the SDK sends only to the shell's origin."""
    shell = app_shell.static_file("shell.js")
    sdk = app_shell.static_file("sdk.js")
    assert 'event.source !== frame.contentWindow || event.origin !== "null"' in shell
    assert f'var SANDBOX = "{app_shell.APP_SANDBOX}"' in shell
    code = shell.split("*/", 1)[1]  # past the header comment
    assert "allow-same-origin" not in code
    assert 'window.origin !== "null"' in shell  # a sandboxed copy refuses to run
    assert "event.source !== parentWindow || event.origin !== shellOrigin" in sdk
    assert "1024 * 1024" in shell


def test_rewrite_brings_old_pages_to_the_sdk_and_keeps_the_published_version(
    db_session: Session, published: BuilderProject, config
) -> None:
    from app.db import rewrite_app_runtime

    root = app_runtime.apps_root(config)
    # As written before P1, and a later draft edit that is not published.
    (root / published.app_slug / "index.html").write_text("<head><script>old shim</script>", encoding="utf-8")
    edited = {"index.html": "<!doctype html><head><title>새 초안</title></head>"}
    builder_versions.replace_files(db_session, published, edited)
    builder_versions.snapshot(db_session, published, "고치기", edited)
    db_session.commit()

    counts = rewrite_app_runtime.rewrite(db_session, config)

    assert counts == (1, 1, [])
    public = (root / published.app_slug / "index.html").read_text(encoding="utf-8")
    draft = (root / published.draft_slug / "index.html").read_text(encoding="utf-8")
    assert app_runtime.SDK_TAG in public and "old shim" not in public and "새 초안" not in public
    assert app_runtime.SDK_TAG in draft and "새 초안" in draft
