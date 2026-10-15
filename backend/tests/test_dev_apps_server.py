"""The local stand-in for apps.ctrlai.my answers as Caddy does
(builder-static-runtime, app-platform P1) — and the Caddyfile still says
the same."""

import http.server
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from app.core.config import Settings
from app.dev_apps_server import content_security_policy, make_server
from app.services import app_shell

CADDYFILE = Path(__file__).resolve().parents[2] / "deploy" / "Caddyfile"
SLUG = "abcdefgh23"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


OPENER = urllib.request.build_opener(NoRedirect)


class StubBackend(http.server.BaseHTTPRequestHandler):
    """Stands in for the api: echoes the path and the headers it got."""

    def do_GET(self) -> None:  # noqa: N802
        body = f"{self.path}|{self.headers.get('X-CtrlAI-App', '')}".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # noqa: ANN002
        pass


@pytest.fixture
def served(tmp_path):
    apps = tmp_path / "apps"
    (apps / SLUG / "js").mkdir(parents=True)
    (apps / SLUG / "index.html").write_text("<p>앱</p>", encoding="utf-8")
    (apps / SLUG / "js" / "app.js").write_text("let a", encoding="utf-8")
    (apps / f".tmp-{SLUG}-0000").mkdir()
    (apps / f".tmp-{SLUG}-0000" / "index.html").write_text("half", encoding="utf-8")
    backend = http.server.ThreadingHTTPServer(("127.0.0.1", 0), StubBackend)
    threading.Thread(target=backend.serve_forever, daemon=True).start()
    settings = Settings(
        app_env="development", apps_dir=str(apps), cors_allow_origins="http://localhost:3000",
        apps_base_url="http://localhost:8300",
    )
    server = make_server(0, settings=settings, api_base=f"http://127.0.0.1:{backend.server_address[1]}")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    backend.shutdown()
    backend.server_close()


def fetch(url: str, method: str = "GET", headers: dict | None = None):
    request = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        response = OPENER.open(request)
        return response.status, response.headers, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        return error.code, error.headers, ""


def test_member_files_are_served_sandboxed_with_no_network(served: str) -> None:
    status, headers, body = fetch(f"{served}/{SLUG}/_app/index.html")
    assert status == 200 and body == "<p>앱</p>"
    csp = headers["Content-Security-Policy"]
    assert csp == content_security_policy("http://localhost:8300 http://localhost:3000")
    assert csp.startswith(f"sandbox {app_shell.APP_SANDBOX};")
    assert "allow-same-origin" not in csp and "connect-src 'none'" in csp
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Referrer-Policy"] == "no-referrer"
    assert headers.get("Set-Cookie") is None
    assert fetch(f"{served}/{SLUG}/_app/js/app.js")[2] == "let a"


def test_the_shell_and_the_platform_come_from_the_backend(served: str) -> None:
    assert fetch(f"{served}/{SLUG}/")[2] == f"/_ctrlai/shell/{SLUG}|"
    status, _, body = fetch(f"{served}/_ctrlai/v1/app", headers={"X-CtrlAI-App": SLUG})
    assert status == 200 and body == f"/_ctrlai/v1/app|{SLUG}"


def test_old_addresses_redirect_to_the_shell_and_the_app_folder(served: str) -> None:
    status, headers, _ = fetch(f"{served}/{SLUG}")
    assert status == 301 and headers["Location"] == f"/{SLUG}/"
    status, headers, _ = fetch(f"{served}/{SLUG}/js/app.js")
    assert status == 301 and headers["Location"] == f"/{SLUG}/_app/js/app.js"


def test_no_listing_no_hidden_folders_no_writes(served: str) -> None:
    assert fetch(f"{served}/")[0] == 404
    assert fetch(f"{served}/.tmp-{SLUG}-0000/index.html")[0] == 404
    assert fetch(f"{served}/{SLUG}/_app/.hidden")[0] == 404
    assert fetch(f"{served}/{SLUG}/_app/index.html", method="POST")[0] == 405
    assert fetch(f"{served}/{SLUG}/", method="POST")[0] == 405


def test_the_caddyfile_sends_the_same_policies_and_routes() -> None:
    caddy = CADDYFILE.read_text(encoding="utf-8")
    block = caddy[caddy.index("apps.{$SITE_DOMAIN} {") :]
    assert app_shell.app_files_csp("https://apps.{$SITE_DOMAIN} https://{$SITE_DOMAIN}") in block
    appfile = block[block.index("handle @appfile") : block.index("@bare")]
    for line in ("-Set-Cookie", "hide .*", "root * /srv/apps", "respond @notRead 405"):
        assert line in appfile, line
    for line in ('X-Content-Type-Options "nosniff"', 'Referrer-Policy "no-referrer"'):
        assert line in block
    assert "rewrite * /_ctrlai/shell/{re.shell.1}" in block
    # `redir /x/ …` would read /x/ as a matcher: the target needs `*` first.
    assert "redir * /{re.bare.1}/ permanent" in block
    assert "redir * /{re.oldfile.1}/_app/{re.oldfile.2} permanent" in block
    assert "browse" not in block
    # The apps origin reaches the app-platform router only — never the site.
    assert "web:3000" not in block
    assert block.count("reverse_proxy") == 2 and "reverse_proxy api:8000" in block
