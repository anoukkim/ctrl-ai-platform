"""What every raw-bytes upload route shares (chat-plus-files, feedback-screenshots).

A member's file arrives as the request body — one file per request, its
name in `?name=` — and goes back out as a response with the same guard
headers. Both halves live here so a hardening change (the name sanitiser,
the CSP, the simple-type refusal) is made once.
"""

from __future__ import annotations

import urllib.parse

from fastapi import HTTPException, Request, Response, status

from app.core.json_only import SIMPLE_CONTENT_TYPES


async def read_upload_body(request: Request, limit: int, too_big: str, simple_type_refusal: str) -> bytes:
    """The body's bytes, read only up to `limit` plus one chunk.

    A page on another origin — a member app on apps.ctrlai.my is
    same-site — may send a "simple" request (text/plain, a form type or
    no type at all) without a CORS preflight. Requiring a non-simple type
    forces that preflight, which the API refuses (CLAUDE.md §2). A larger
    upload is refused (413) without being held in memory.
    """
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type in SIMPLE_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=simple_type_refusal)
    chunks: list[bytes] = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > limit:
            raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=too_big)
        chunks.append(chunk)
    return b"".join(chunks)


def clean_upload_name(name: str, fallback: str) -> str:
    """Only the last path part, printable characters only: the name is
    shown back to the member and used in a download header."""
    base = name.strip().replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(ch for ch in base if ch.isprintable())[:255] or fallback


def file_response(data: bytes, media_type: str, name: str, inline: bool) -> Response:
    """A stored file, sent back with the headers that keep it a file: never
    sniffed into something else, never a page of this site, cached only
    by the browser that asked."""
    quoted = urllib.parse.quote(name)
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quoted}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600",
            "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        },
    )
