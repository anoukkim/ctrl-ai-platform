"""The local stand-in for apps.ctrlai.my sends Caddy's headers
(builder-static-runtime) — and the Caddyfile still says the same."""

import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from app.core.config import Settings
from app.dev_apps_server import content_security_policy, make_server

CADDYFILE = Path(__file__).resolve().parents[2] / "deploy" / "Caddyfile"


@pytest.fixture
def served(tmp_path):
    apps = tmp_path / "apps"
    (apps / "abc123").mkdir(parents=True)
    (apps / "abc123" / "index.html").write_text("<p>앱</p>", encoding="utf-8")
    (apps / ".tmp-abc123-0000").mkdir()
    (apps / ".tmp-abc123-0000" / "index.html").write_text("half", encoding="utf-8")
    settings = Settings(
        app_env="development", apps_dir=str(apps), cors_allow_origins="http://localhost:3000"
    )
    server = make_server(0, settings=settings)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def status_of(url: str, method: str = "GET") -> int:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method=method)) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def test_an_app_is_served_with_the_runtime_headers(served: str) -> None:
    with urllib.request.urlopen(f"{served}/abc123/") as response:
        assert response.read().decode("utf-8") == "<p>앱</p>"
        headers = response.headers
    assert headers["Content-Security-Policy"] == content_security_policy("http://localhost:3000")
    assert "frame-ancestors http://localhost:3000" in headers["Content-Security-Policy"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Referrer-Policy"] == "no-referrer"
    assert headers.get("Set-Cookie") is None


def test_no_listing_no_hidden_folders_no_writes(served: str) -> None:
    assert status_of(f"{served}/") == 404
    assert status_of(f"{served}/.tmp-abc123-0000/index.html") == 404
    assert status_of(f"{served}/abc123/", method="POST") == 405


def test_the_caddyfile_sends_the_same_policy() -> None:
    caddy = CADDYFILE.read_text(encoding="utf-8")
    block = caddy[caddy.index("apps.{$SITE_DOMAIN} {") :]
    assert content_security_policy("https://{$SITE_DOMAIN}") in block
    for line in ('X-Content-Type-Options "nosniff"', 'Referrer-Policy "no-referrer"', "-Set-Cookie", "hide .*"):
        assert line in block
    assert "browse" not in block
    assert "reverse_proxy" not in block, "the apps origin never reaches the app servers"
