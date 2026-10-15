"""The apps origin, for local development only (builder-static-runtime,
app-platform P1).

On the server, Caddy serves member apps from `apps.ctrlai.my`
(`deploy/Caddyfile`). Locally, run this beside the backend:

    python -m app.dev_apps_server            # http://localhost:8300

and set `APPS_BASE_URL=http://localhost:8300` for the backend. It answers
exactly as Caddy's `apps.` block does:

* `/<slug>/` — the trusted shell, from the backend (`/_ctrlai/shell/<slug>`);
* `/<slug>/_app/<file>` — the member's file from `APPS_DIR`, read-only,
  with `app_shell.app_files_csp` (sandboxed, no network), nosniff,
  no-referrer, never a cookie, no listings, no hidden files;
* `/_ctrlai/*` — passed to the backend (`--api`, default
  http://127.0.0.1:8000), method, headers and body as they came;
* `/<slug>` and `/<slug>/<file>` (addresses from before the shell) —
  a permanent redirect to `/<slug>/` and `/<slug>/_app/<file>`.

It serves files and forwards; it never runs anything.
"""

from __future__ import annotations

import argparse
import functools
import http.client
import http.server
import re
from pathlib import Path
from urllib.parse import urlsplit

from app.core.config import Settings, get_settings
from app.services import app_shell
from app.services.app_runtime import apps_root

SHELL = re.compile(r"^/([a-z2-9]{10})/$")
APP_FILE = re.compile(r"^/([a-z2-9]{10})/_app/(.+)$")
BARE = re.compile(r"^/([a-z2-9]{10})$")
OLD_FILE = re.compile(r"^/([a-z2-9]{10})/(?!_app/)(.+)$")

#: Headers not passed through the proxy (hop-by-hop, or set again here).
HOP = {
    "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer", "host",
    "server", "date",
}


def content_security_policy(frame_ancestors: str) -> str:
    """The CSP on every member file — the same text as the Caddyfile."""
    return app_shell.app_files_csp(frame_ancestors)


class AppsHandler(http.server.SimpleHTTPRequestHandler):
    frame_ancestors = "'none'"
    api_base = "http://127.0.0.1:8000"
    _serving_file = False

    # ------------------------------------------------------------ routing
    def _route(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/_ctrlai/"):
            self._proxy(self.path)
            return
        if self.command not in ("GET", "HEAD"):
            self.send_error(405)
            return
        if match := SHELL.match(path):
            self._proxy(f"/_ctrlai/shell/{match.group(1)}")
            return
        if match := BARE.match(path):
            self._redirect(f"/{match.group(1)}/")
            return
        if match := APP_FILE.match(path):
            rest = match.group(2)
            if any(part.startswith(".") or not part for part in rest.split("/")):
                self.send_error(404)
                return
            self.path = f"/{match.group(1)}/{rest}"
            self._serving_file = True
            super().do_GET() if self.command == "GET" else super().do_HEAD()
            return
        if match := OLD_FILE.match(path):
            self._redirect(f"/{match.group(1)}/_app/{match.group(2)}")
            return
        self.send_error(404)

    do_GET = _route  # noqa: N815 — the stdlib's naming
    do_HEAD = _route  # noqa: N815
    do_POST = _route  # noqa: N815
    do_PUT = _route  # noqa: N815
    do_PATCH = _route  # noqa: N815
    do_DELETE = _route  # noqa: N815

    def _redirect(self, location: str) -> None:
        self.send_response(301)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _proxy(self, target: str) -> None:
        api = urlsplit(self.api_base)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {name: value for name, value in self.headers.items() if name.lower() not in HOP}
        try:
            connection = http.client.HTTPConnection(api.hostname, api.port or 80, timeout=60)
            connection.request(self.command, target, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
        except OSError:
            self.send_error(502, "backend not reachable")
            return
        self.send_response(response.status)
        for name, value in response.getheaders():
            if name.lower() not in HOP and name.lower() != "content-length":
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    # ------------------------------------------------------------ static files
    def end_headers(self) -> None:
        if self._serving_file:
            self.send_header("Content-Security-Policy", content_security_policy(self.frame_ancestors))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def send_header(self, keyword: str, value: str) -> None:
        if self._serving_file and keyword.lower() == "set-cookie":
            return
        super().send_header(keyword, value)

    def list_directory(self, path):  # type: ignore[override]
        self.send_error(404)
        return None


def make_server(
    port: int = 8300,
    host: str = "127.0.0.1",
    settings: Settings | None = None,
    api_base: str = "http://127.0.0.1:8000",
) -> http.server.ThreadingHTTPServer:
    settings = settings or get_settings()
    if not settings.is_development:
        raise SystemExit("dev_apps_server is for local development only (APP_ENV=development).")
    root = apps_root(settings)
    root.mkdir(parents=True, exist_ok=True)
    origin = settings.apps_origin or f"http://localhost:{port}"
    ancestors = " ".join([origin, *app_shell.site_origins(settings)]) or "'none'"
    handler = type(
        "BoundAppsHandler",
        (AppsHandler,),
        {"frame_ancestors": ancestors, "api_base": api_base},
    )
    return http.server.ThreadingHTTPServer(
        (host, port), functools.partial(handler, directory=str(Path(root)))
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8300)
    parser.add_argument("--api", default="http://127.0.0.1:8000", help="the backend, for /_ctrlai/*")
    args = parser.parse_args()
    server = make_server(args.port, api_base=args.api)
    print(f"Member apps: http://localhost:{args.port}/<app-slug>/  (APPS_DIR: {apps_root(get_settings())})")
    server.serve_forever()


if __name__ == "__main__":
    main()
