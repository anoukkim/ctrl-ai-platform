"""thumbs — the thumbnail render worker (thumbnail-render-worker).

A tiny HTTP service the api calls to photograph a published member app
with a real headless Chromium:

    POST /render   {"url": "https://apps.ctrlai.my/<slug>/_app/index.html?v=…"}
                   header X-Thumbs-Secret: <THUMBS_SECRET>
                   → 200 image/png (1024×640), or 4xx/5xx {"detail": "…"}
    GET  /health   → 200 {"ok": true}   (the compose healthcheck)

On the server it listens on a **unix socket** in a volume shared with the
api only (`THUMBS_SOCKET`), so the api and this container share no
network at all; the container's one network is internal (no NAT) and
holds caddy alone, and `THUMBS_RESOLVE_TO` is caddy's fixed address there
— the only place apps.<domain> leads. A TCP port (`THUMBS_PORT`) is for
development.

Member code runs here and nowhere else, so this process assumes it is
hostile and fences it in three ways:

* **The address is checked again** — only the configured host
  (`THUMBS_ALLOWED_HOST`, e.g. apps.ctrlai.my), only https (http in
  development), only `/<ten letters and digits>/_app/index.html`.
* **Chromium can reach only that host**: `--host-resolver-rules` maps the
  allowed host to `THUMBS_RESOLVE_TO` (caddy's address on the internal
  network) when set, and makes every other name fail to resolve; a
  Playwright route aborts every request whose host is not the allowed one
  (so an IP address written into the page goes nowhere either). `data:` and `blob:` stay, they
  never leave the page. Service workers are blocked, downloads refused,
  no permissions are granted.
* **One picture at a time, bounded**: a lock serialises renders (a second
  caller waits, then gets 503), navigation gets at most
  `timeout_s - 5` seconds and the screenshot the rest; every render runs
  in a fresh browser that is closed afterwards, so nothing carries over.
  WebSockets are closed by a route, WebRTC may not open UDP to anything.

Chromium's own sandbox (user namespaces) stays **on**: the container runs
with a seccomp profile that allows the namespace syscalls
(deploy/chromium-seccomp.json, Playwright's published one) while still
dropping every capability. `THUMBS_NO_SANDBOX=1` turns it off for a
development machine that cannot create namespaces — never on the server.
The container adds the rest (docker-compose.prod.yml): 768 MB, one CPU,
read-only filesystem, non-root, no capabilities, no privilege escalation.

Runs on mcr.microsoft.com/playwright/python (thumbs/Dockerfile). Only the
standard library plus `playwright`, which is imported when the first
render happens, so this file can be tested without a browser.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

logger = logging.getLogger("thumbs")

VIEWPORT = {"width": 1024, "height": 640}
MAX_BODY = 4096
#: The longest a render may take, whatever the caller asks for.
TIMEOUT_CAP_S = 30
DEFAULT_TIMEOUT_S = 20
#: How long a second caller waits for the lock before 503.
BUSY_WAIT_S = 25
#: A moment after `load` for fonts, images and first animations to settle.
SETTLE_MS = 700

PATH = re.compile(r"^/[a-z2-9]{10}/_app/index\.html$")


class Refusal(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def config() -> dict[str, Any]:
    secret = os.environ.get("THUMBS_SECRET", "")
    host = os.environ.get("THUMBS_ALLOWED_HOST", "").strip().lower()
    if not secret or not host:
        raise SystemExit("THUMBS_SECRET and THUMBS_ALLOWED_HOST must be set")
    return {
        "secret": secret,
        "host": host,
        "allow_http": os.environ.get("THUMBS_ALLOW_HTTP", "") == "1",
        "port": int(os.environ.get("THUMBS_PORT", "8080")),
        "socket": os.environ.get("THUMBS_SOCKET", "").strip() or None,
        "resolve_to": os.environ.get("THUMBS_RESOLVE_TO", "").strip() or None,
        "channel": os.environ.get("THUMBS_CHROMIUM_CHANNEL", "") or None,
        "sandbox": os.environ.get("THUMBS_NO_SANDBOX", "") != "1",
    }


def check_url(url: str, allowed_host: str, allow_http: bool = False) -> str:
    """The address the browser may open, or `Refusal`.

    Only the allowed host (with its port, exactly), https unless
    development says otherwise, the published-files path pattern, no
    userinfo, no fragment. The query is kept (a cache-buster).
    """
    if not isinstance(url, str) or len(url) > 512:
        raise Refusal(400, "url must be a short string")
    parts = urlsplit(url)
    if parts.scheme not in ({"https", "http"} if allow_http else {"https"}):
        raise Refusal(400, "scheme not allowed")
    if not parts.netloc or "@" in parts.netloc or parts.netloc.lower() != allowed_host:
        raise Refusal(400, "host not allowed")
    if not PATH.match(parts.path):
        raise Refusal(400, "path not allowed")
    if parts.fragment:
        raise Refusal(400, "fragment not allowed")
    return url


def resolver_rules(allowed_host: str, resolve_to: str | None = None) -> str:
    """Chromium's DNS: every name is NOTFOUND except the allowed host —
    which, with `resolve_to`, goes to that address (caddy on the internal
    network) and nowhere else. The first matching rule wins, so the
    host's own rule comes first."""
    hostname = allowed_host.split(":")[0]
    if resolve_to:
        return f"MAP {hostname} {resolve_to}, MAP * ~NOTFOUND"
    return f"MAP * ~NOTFOUND, EXCLUDE {hostname}"


def request_allowed(request_url: str, allowed_host: str) -> bool:
    """The route filter: same host (and port) only; data/blob stay inside
    the page. Everything else — other sites, IP addresses, the api — is
    aborted before it leaves the browser."""
    parts = urlsplit(request_url)
    if parts.scheme in {"data", "blob", "about"}:
        return True
    if parts.scheme not in {"http", "https"}:
        return False
    return parts.netloc.lower() == allowed_host


def launch_args(allowed_host: str, resolve_to: str | None = None) -> list[str]:
    """Chromium's command line: the resolver rules, and no side channels —
    WebRTC may not open UDP to anything (a Playwright route sees only
    HTTP(S), and CSP does not govern RTCPeerConnection)."""
    return [
        f"--host-resolver-rules={resolver_rules(allowed_host, resolve_to)}",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--force-webrtc-ip-handling-policy",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-sync",
        "--no-first-run",
        "--mute-audio",
    ]


def render(
    url: str,
    allowed_host: str,
    timeout_s: int,
    channel: str | None = None,
    sandbox: bool = True,
    resolve_to: str | None = None,
) -> bytes:
    """A PNG of the page's first screen. Raises `Refusal(504)` on a
    timeout and `Refusal(502)` when the page could not be loaded."""
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import TimeoutError as PlaywrightTimeout
    from playwright.sync_api import sync_playwright

    timeout_s = max(5, min(int(timeout_s), TIMEOUT_CAP_S))
    nav_ms = (timeout_s - 5) * 1000
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            channel=channel, chromium_sandbox=sandbox, args=launch_args(allowed_host, resolve_to)
        )
        try:
            context = browser.new_context(
                viewport=VIEWPORT,
                device_scale_factor=1,
                java_script_enabled=True,
                accept_downloads=False,
                ignore_https_errors=False,
                bypass_csp=False,
                service_workers="block",
                permissions=[],
                locale="ko-KR",
                timezone_id="Asia/Seoul",
                color_scheme="light",
            )
            context.set_default_timeout(nav_ms)

            def gate(route, request) -> None:  # noqa: ANN001 — Playwright's types
                if request_allowed(request.url, allowed_host):
                    route.continue_()
                else:
                    route.abort("blockedbyclient")

            context.route("**/*", gate)
            # WebSockets are not HTTP requests to the route above: closed here
            # (the files' CSP connect-src 'none' refuses them as well).
            context.route_web_socket("**/*", lambda ws: ws.close())
            page = context.new_page()
            # Nothing a page can open: dialogs are dismissed, popups closed.
            page.on("dialog", lambda dialog: dialog.dismiss())
            context.on("page", lambda popup: popup.close() if popup is not page else None)
            try:
                page.goto(url, wait_until="load", timeout=nav_ms)
                page.wait_for_timeout(SETTLE_MS)
                return page.screenshot(type="png", full_page=False, timeout=5000, animations="disabled")
            except PlaywrightTimeout as error:
                raise Refusal(504, "render timed out") from error
            except PlaywrightError as error:
                raise Refusal(502, f"page failed: {type(error).__name__}") from error
        finally:
            browser.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "thumbs/1"
    cfg: dict[str, Any] = {}
    lock = threading.Lock()

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003 — BaseHTTPRequestHandler's name
        # On a unix socket the client address is an empty string.
        peer = self.client_address[0] if isinstance(self.client_address, tuple) else "unix"
        logger.info("%s " + fmt, peer or "unix", *args)

    def _json(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 — the server's name
        if self.path == "/health":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"detail": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/render":
            self._json(404, {"detail": "not found"})
            return
        given = self.headers.get("X-Thumbs-Secret", "")
        if not hmac.compare_digest(given.encode(), self.cfg["secret"].encode()):
            self._json(403, {"detail": "forbidden"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self._json(413, {"detail": "body too large"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            self._json(400, {"detail": "json body required"})
            return
        try:
            url = check_url(body.get("url"), self.cfg["host"], self.cfg["allow_http"])
        except Refusal as refusal:
            self._json(refusal.status, {"detail": refusal.detail})
            return
        timeout_s = body.get("timeout_s", DEFAULT_TIMEOUT_S)
        if not isinstance(timeout_s, int):
            timeout_s = DEFAULT_TIMEOUT_S
        if not self.lock.acquire(timeout=BUSY_WAIT_S):
            self._json(503, {"detail": "busy"})
            return
        try:
            png = render(
                url, self.cfg["host"], timeout_s, self.cfg["channel"], self.cfg["sandbox"], self.cfg["resolve_to"]
            )
        except Refusal as refusal:
            self._json(refusal.status, {"detail": refusal.detail})
            return
        except Exception as error:  # noqa: BLE001 — never a traceback to the caller
            logger.exception("render failed")
            self._json(500, {"detail": f"render failed: {type(error).__name__}"})
            return
        finally:
            self.lock.release()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(png)))
        self.end_headers()
        self.wfile.write(png)


class UnixHTTPServer(ThreadingHTTPServer):
    """The same server on a unix socket (`THUMBS_SOCKET`)."""

    address_family = socket.AF_UNIX

    def server_bind(self) -> None:
        import socketserver

        path = Path(self.server_address)  # type: ignore[arg-type]
        if path.exists():
            path.unlink()  # a socket left by the previous run
        # TCPServer's bind, not HTTPServer's: that one looks up a host name
        # from the address, which a path does not have.
        socketserver.TCPServer.server_bind(self)
        # The api runs as another user: it only needs to connect; the
        # directory (the shared volume) is what keeps everyone else out.
        path.chmod(0o666)
        self.server_name = "thumbs"
        self.server_port = 0


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    Handler.cfg = config()
    if Handler.cfg["socket"]:
        server: ThreadingHTTPServer = UnixHTTPServer(Handler.cfg["socket"], Handler)  # type: ignore[arg-type]
        logger.info(
            "thumbs listening on %s for %s (-> %s)",
            Handler.cfg["socket"],
            Handler.cfg["host"],
            Handler.cfg["resolve_to"] or "public DNS",
        )
    else:
        server = ThreadingHTTPServer(("0.0.0.0", Handler.cfg["port"]), Handler)
        logger.info("thumbs listening on port %s for %s", Handler.cfg["port"], Handler.cfg["host"])
    if not Handler.cfg["sandbox"]:
        logger.warning("Chromium sandbox OFF (THUMBS_NO_SANDBOX=1) — development only")
    server.serve_forever()


def probe() -> int:
    """`python worker.py --probe`: GET /health over the configured socket
    or port; exit 0 when the worker answers (the compose healthcheck)."""
    import http.client

    path = os.environ.get("THUMBS_SOCKET", "").strip()
    if path:
        conn = http.client.HTTPConnection("thumbs", timeout=4)
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(4)
        sock.connect(path)
        conn.sock = sock
    else:
        conn = http.client.HTTPConnection("127.0.0.1", int(os.environ.get("THUMBS_PORT", "8080")), timeout=4)
    conn.request("GET", "/health")
    return 0 if conn.getresponse().status == 200 else 1


if __name__ == "__main__":
    if "--probe" in sys.argv[1:]:
        sys.exit(probe())
    main()
