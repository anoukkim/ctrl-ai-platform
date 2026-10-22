"""app-open-services (owner 2026-10-22): member apps may load outside https
services — maps, photos, CDN libraries, keyless APIs — and still never
reach CTRL+AI's own data.

What keeps CTRL+AI out is not the CSP any more but three things, each held
here: the frame stays opaque (no `allow-same-origin`), so its requests are
cross-site; the session cookie is Lax/Strict, so it never rides on them;
and the API answers no CORS, so nothing comes back (`Origin: null` is what
a sandboxed frame sends).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.services import app_shell
from tests.conftest import DEV_PASSWORD
from tests.test_beta_launch import SERVER_DATABASE

#: The directives an app uses to load things; each one takes `https:`.
LOADING = ("script-src", "style-src", "img-src", "media-src", "font-src", "connect-src")


def directives(csp: str) -> dict[str, list[str]]:
    parsed: dict[str, list[str]] = {}
    for part in csp.split(";"):
        words = part.split()
        if words:
            parsed[words[0]] = words[1:]
    return parsed


def test_apps_may_load_from_any_https_host_and_nothing_else() -> None:
    policy = directives(app_shell.app_files_csp("https://apps.ctrlai.my https://ctrlai.my"))
    for name in LOADING:
        assert "https:" in policy[name], name
        # No plain http, no sockets, no wildcard, no eval.
        for word in policy[name]:
            assert word not in ("*", "http:", "ws:", "wss:", "'unsafe-eval'"), (name, word)
            assert not word.startswith("http://"), (name, word)
    assert policy["default-src"] == ["'self'"]
    # Libraries may start workers from their own code.
    assert policy["worker-src"] == ["'self'", "blob:"]
    assert policy["frame-ancestors"] == ["https://apps.ctrlai.my", "https://ctrlai.my"]


def test_the_app_frame_stays_opaque() -> None:
    policy = directives(app_shell.app_files_csp("https://ctrlai.my"))
    assert policy["sandbox"] == app_shell.APP_SANDBOX.split()
    assert "allow-same-origin" not in app_shell.APP_SANDBOX
    assert "allow-top-navigation" not in app_shell.APP_SANDBOX


def test_the_session_cookie_never_rides_on_an_apps_request(anon_client: TestClient, dev_user) -> None:
    login = anon_client.post(
        "/api/auth/login", json={"username": dev_user.username, "password": DEV_PASSWORD}
    )
    assert login.status_code == 200
    cookie = login.headers["set-cookie"].lower()
    assert "httponly" in cookie and "domain=" not in cookie
    assert "samesite=lax" in cookie or "samesite=strict" in cookie


@pytest.mark.parametrize("value", ["none", "None", ""])
def test_a_deployed_server_refuses_samesite_none(value: str) -> None:
    problems = Settings(
        app_env="beta", database_url=SERVER_DATABASE, session_cookie_samesite=value
    ).startup_problems()
    assert any("SESSION_COOKIE_SAMESITE" in problem for problem in problems)
    for fine in ("lax", "strict"):
        assert Settings(
            app_env="beta", database_url=SERVER_DATABASE, session_cookie_samesite=fine
        ).startup_problems() == []


def test_the_api_answers_no_cors_to_a_sandboxed_app(anon_client: TestClient) -> None:
    """A sandboxed frame's requests carry `Origin: null`."""
    preflight = anon_client.options(
        "/api/auth/me",
        headers={"Origin": "null", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in preflight.headers
    for path in ("/api/health", "/api/auth/me", "/api/usage/me"):
        response = anon_client.get(path, headers={"Origin": "null"})
        assert "access-control-allow-origin" not in response.headers, path


def test_every_app_prompt_carries_the_outside_service_rules() -> None:
    from app.services.claude_provider import EDIT_SYSTEM, STARTER_SYSTEM, _APP_RULES, _OUTSIDE_RULES

    for prompt in (STARTER_SYSTEM, EDIT_SYSTEM, _APP_RULES):
        assert _OUTSIDE_RULES in prompt
        assert "No external scripts" not in prompt
    # Free and keyless first; never a key; never an address from memory.
    assert "tile.openstreetmap.org" in _OUTSIDE_RULES and "© OpenStreetMap" in _OUTSIDE_RULES
    assert "strict-origin-when-cross-origin" in _OUTSIDE_RULES  # OSM's tile policy wants a referrer
    assert "Never put an API key" in _OUTSIDE_RULES
    assert "Never write a photo, file or API address from memory" in _OUTSIDE_RULES
    assert "never http" in _OUTSIDE_RULES
