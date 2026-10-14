"""The apps origin, for local development only (builder-static-runtime).

On the server, Caddy serves member apps from `apps.ctrlai.my`
(`deploy/Caddyfile`). Locally, run this beside the backend:

    python -m app.dev_apps_server            # http://localhost:8300

and set `APPS_BASE_URL=http://localhost:8300` for the backend. It serves
`APPS_DIR` read-only with the same headers as Caddy: the CSP (framing
allowed only by the frontend origins in `CORS_ALLOW_ORIGINS`), nosniff,
no-referrer, no cookies, no directory listings and no hidden files. It
serves files; it never runs anything.
"""

from __future__ import annotations

import argparse
import functools
import http.server
from pathlib import Path

from app.core.config import Settings, get_settings
from app.services.app_runtime import apps_root


def content_security_policy(frame_ancestors: str) -> str:
    """The CSP every member-app response carries — the same as the Caddyfile."""
    return (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
        f"frame-ancestors {frame_ancestors}"
    )


class AppsHandler(http.server.SimpleHTTPRequestHandler):
    frame_ancestors = "'none'"

    def end_headers(self) -> None:
        self.send_header("Content-Security-Policy", content_security_policy(self.frame_ancestors))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def send_header(self, keyword: str, value: str) -> None:
        if keyword.lower() == "set-cookie":
            return
        super().send_header(keyword, value)

    def list_directory(self, path):  # type: ignore[override]
        self.send_error(404)
        return None

    def send_head(self):  # type: ignore[override]
        parts = [part for part in self.path.split("?")[0].split("/") if part]
        if any(part.startswith(".") for part in parts):
            self.send_error(404)
            return None
        return super().send_head()

    def do_POST(self) -> None:  # noqa: N802 — the stdlib's naming
        self.send_error(405)


def make_server(
    port: int = 8300, host: str = "127.0.0.1", settings: Settings | None = None
) -> http.server.ThreadingHTTPServer:
    settings = settings or get_settings()
    if not settings.is_development:
        raise SystemExit("dev_apps_server is for local development only (APP_ENV=development).")
    root = apps_root(settings)
    root.mkdir(parents=True, exist_ok=True)
    handler = type(
        "BoundAppsHandler",
        (AppsHandler,),
        {"frame_ancestors": " ".join(settings.cors_origins) or "'none'"},
    )
    return http.server.ThreadingHTTPServer(
        (host, port), functools.partial(handler, directory=str(Path(root)))
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8300)
    args = parser.parse_args()
    server = make_server(args.port)
    print(f"Member apps: http://localhost:{args.port}/<app-slug>/  (APPS_DIR: {apps_root(get_settings())})")
    server.serve_forever()


if __name__ == "__main__":
    main()
