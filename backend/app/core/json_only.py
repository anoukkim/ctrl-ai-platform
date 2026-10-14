"""State-changing requests must not be "simple" (CLAUDE.md §2).

Member apps are served from `apps.ctrlai.my`, which is *same-site* with
`ctrlai.my`: a page there could make the browser send a POST to
`ctrlai.my/api/...`, and `SameSite=Lax` would not keep the session cookie
off it. What stops such a request is CORS — but only for requests that
need a preflight. A POST whose `Content-Type` is missing, `text/plain`,
`multipart/form-data` or `application/x-www-form-urlencoded` is a
"simple" request: the browser sends it without asking first.

So every POST to the API must carry another type — `application/json`
for ordinary routes, `application/octet-stream` for a file upload. Such a
request from another origin needs a preflight, the API answers that
without `Access-Control-Allow-Origin`, and the browser never sends it.
PUT, PATCH and DELETE always need a preflight, whatever their body.

A plain ASGI middleware, not `BaseHTTPMiddleware`, so streamed chat
replies pass through untouched.
"""

from __future__ import annotations

import json
from typing import Any

#: The request types a browser sends cross-origin without a preflight.
SIMPLE_CONTENT_TYPES = {
    "",
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
}

REFUSAL = "요청 형식이 올바르지 않습니다. 본문을 JSON(application/json)으로 보내 주세요."


def content_type_of(headers: list[tuple[bytes, bytes]]) -> str:
    for name, value in headers:
        if name.lower() == b"content-type":
            return value.decode("latin-1").split(";")[0].strip().lower()
    return ""


class JsonOnlyMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] == "POST"
            and scope["path"].startswith("/api/")
            and content_type_of(scope.get("headers", [])) in SIMPLE_CONTENT_TYPES
        ):
            body = json.dumps({"detail": REFUSAL}, ensure_ascii=False).encode("utf-8")
            await send(
                {
                    "type": "http.response.start",
                    "status": 415,
                    "headers": [
                        (b"content-type", b"application/json; charset=utf-8"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
