"""Server-side thumbnails (thumbnail-render-worker).

`THUMBNAIL_RENDERER=browser` (the default) is today's behaviour: the
picture is drawn in the maker's or the admin's own browser and uploaded
(`services/thumbnails`). `THUMBNAIL_RENDERER=server` adds a **real headless
Chromium in its own container** (`thumbs` in docker-compose.prod.yml): the
api asks it for a 1024×640 screenshot of the published app, and the PNG
goes through the same `thumbnails.encode` (first screen, 640×400 WebP)
into the same storage. The in-browser capture stays as it is and is the
fallback — a failed or refused render keeps whatever picture or cover the
app had.

The isolation lives in three places, each of which alone would hold:

1. **What the api asks for** — never a URL from a request. `published_url`
   builds it from `APPS_BASE_URL` and the project's own slug (ten letters
   and digits), to the app's files under `/_app/`, which the apps origin
   serves under a `sandbox … connect-src 'none'` policy.
2. **The worker** (`thumbs/worker.py`) — checks the shared secret, checks
   the URL again against its own allowed host and path pattern, and runs
   Chromium with every other host name refused and every request to
   another host aborted. One picture at a time, 20 s and it gives up.
3. **The container** — its own network with the api only (never db or
   web), 768 MB, one CPU, read-only, non-root, no capabilities.

The api never waits for a render on the member's request: 게시 queues
one (`enqueue`) and a single worker thread does them in order; Admin ›
Apps' 썸네일 다시 만들기 asks for one at a time and waits (`render_now`).
"""

from __future__ import annotations

import json
import logging
import queue
import re
import threading
import time
from collections.abc import Callable
from typing import Protocol
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import BuilderProject
from app.services import thumbnails
from app.services.attachments import AttachmentRefusal
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

#: The worker's viewport — the first screen a laptop visitor sees; the
#: card's 640×400 is cut from the top of it by `thumbnails.encode`.
VIEWPORT_WIDTH = 1024
VIEWPORT_HEIGHT = 640
#: The worker's own timeout; the api waits this plus a little for the
#: connection, then gives up as well.
DEFAULT_TIMEOUT_S = 20
#: What the api accepts back from the worker (a PNG of 1024×640 is far less).
MAX_IMAGE_BYTES = thumbnails.MAX_UPLOAD_BYTES
#: Renders waiting after 게시 at most — beyond this the newest is dropped
#: (the in-browser capture still ran) rather than piling up.
QUEUE_MAX = 20

SECRET_HEADER = "X-Thumbs-Secret"
_SLUG = re.compile(r"^[a-z2-9]{10}$")

OFF = "서버 썸네일 렌더러가 꺼져 있어요 (THUMBNAIL_RENDERER=browser)."
NOT_PUBLISHED = thumbnails.NOT_PUBLISHED
FAILED = "서버에서 썸네일을 찍지 못했어요. 이전 그림을 그대로 둡니다."


class RenderError(Exception):
    """A Korean sentence for the screen, and an HTTP status for the route."""

    def __init__(self, message: str, status_code: int = 503) -> None:
        super().__init__(message)
        self.status_code = status_code


class Renderer(Protocol):
    def render(self, url: str) -> bytes:
        """The PNG of `url`'s first screen, or raise `RenderError`."""
        ...


def _detail(response: object) -> str:
    """The worker's `detail` (its JSON error body), at most 300 characters,
    for the log — never raises."""
    try:
        body = b""
        for chunk in response.iter_bytes():  # type: ignore[attr-defined]
            body += chunk
            if len(body) > 2048:
                break
        detail = json.loads(body[:2048].decode("utf-8", "replace")).get("detail", "")
        return str(detail)[:300]
    except Exception:  # noqa: BLE001 — the log line must not fail the job
        return "?"


class WorkerRenderer:
    """The real thing: `POST {worker_url}/render {"url"}` with the shared
    secret in a header; the body back is the PNG.

    On the server the worker is reached over a **unix socket** in a volume
    the two containers share (`socket_path`) — no network between them.
    The answer is read as a stream and refused as soon as it is not a
    PNG, has no length, or passes `MAX_IMAGE_BYTES`, so a worker that
    misbehaves cannot make the api buffer gigabytes; the whole call has a
    wall-clock deadline on top of the worker's own.
    """

    def __init__(
        self,
        worker_url: str,
        secret: str,
        timeout_s: int = DEFAULT_TIMEOUT_S,
        socket_path: str = "",
        client_factory: Callable[[], object] | None = None,
    ) -> None:
        self.worker_url = worker_url.rstrip("/")
        self.secret = secret
        self.timeout_s = timeout_s
        self.socket_path = socket_path
        self._client_factory = client_factory

    def _client(self):
        import httpx2 as httpx

        if self._client_factory is not None:
            return self._client_factory()
        # The worker's own deadline plus the time to connect and answer —
        # for every phase (connect, write, read, pool), not per byte.
        timeout = httpx.Timeout(self.timeout_s + 5)
        transport = httpx.HTTPTransport(uds=self.socket_path) if self.socket_path else httpx.HTTPTransport()
        return httpx.Client(transport=transport, timeout=timeout)

    def render(self, url: str) -> bytes:
        deadline = time.monotonic() + self.timeout_s + 5
        try:
            with self._client() as client, client.stream(
                "POST",
                f"{self.worker_url}/render",
                json={"url": url, "timeout_s": self.timeout_s},
                headers={SECRET_HEADER: self.secret},
            ) as response:
                status = getattr(response, "status_code", 0)
                if status != 200:
                    logger.warning("thumbnail worker answered %s: %s", status, _detail(response))
                    raise RenderError(FAILED)
                headers = response.headers
                if not str(headers.get("content-type", "")).startswith("image/png"):
                    raise RenderError(FAILED)
                length = headers.get("content-length")
                if length is None or not str(length).isdigit() or int(length) > MAX_IMAGE_BYTES or int(length) == 0:
                    raise RenderError(FAILED)
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_IMAGE_BYTES or time.monotonic() > deadline:
                        raise RenderError(FAILED)
                    chunks.append(chunk)
        except RenderError:
            raise
        except Exception as error:  # noqa: BLE001 — any transport failure: the old picture stays
            logger.warning("thumbnail worker unreachable: %s", type(error).__name__)
            raise RenderError(FAILED) from error
        data = b"".join(chunks)
        if not data:
            raise RenderError(FAILED)
        return data


class FakeRenderer:
    """Tests only: a solid PNG back, or a failure, and a record of the URLs."""

    def __init__(self, image: bytes | None = None, fail: bool = False) -> None:
        self.image = image if image is not None else _solid_png()
        self.fail = fail
        self.urls: list[str] = []

    def render(self, url: str) -> bytes:
        self.urls.append(url)
        if self.fail:
            raise RenderError(FAILED)
        return self.image


def _solid_png() -> bytes:
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (VIEWPORT_WIDTH, VIEWPORT_HEIGHT), (40, 110, 190)).save(out, format="PNG")
    return out.getvalue()


# ------------------------------------------------------------ the provider


def mode(settings: Settings) -> str:
    """`browser` or `server` — the provider rule's switch."""
    return settings.thumbnail_renderer.strip().lower()


def enabled(settings: Settings) -> bool:
    return mode(settings) == "server"


_override: Renderer | None = None


def use_renderer(renderer: Renderer | None) -> None:
    """Tests: the renderer every call uses, instead of the worker."""
    global _override
    _override = renderer


def get_renderer(settings: Settings) -> Renderer | None:
    """The renderer for this configuration, or None while `browser`."""
    if _override is not None:
        return _override
    if not enabled(settings):
        return None
    return WorkerRenderer(
        settings.thumbnail_worker_url,
        settings.thumbnail_worker_secret,
        settings.thumbnail_render_timeout_s,
        socket_path=settings.thumbnail_worker_socket.strip(),
    )


# ------------------------------------------------------------ the address


def published_url(settings: Settings, project: BuilderProject) -> str:
    """The one address the worker may be asked for: this project's
    published files on the apps origin. Built here from the configuration
    and the project's own slug — never from a request — and refused when
    anything about it is off."""
    origin = settings.apps_origin
    if origin is None:
        raise RenderError("앱 주소(APPS_BASE_URL)가 없어 서버에서 찍을 수 없어요.", 503)
    slug = project.app_slug or ""
    if project.published_version_id is None or not _SLUG.match(slug):
        raise RenderError(NOT_PUBLISHED, 409)
    stamp = project.published_at.isoformat() if project.published_at else ""
    # `?v=` only busts caches (the apps origin serves static files); the
    # worker checks the path, not the query.
    return f"{origin}/{slug}/_app/index.html?v={quote(stamp, safe='')}"


def draft_url(settings: Settings, project: BuilderProject) -> str:
    """draft-server-thumbnails: the working copy's files on the apps
    origin — the same strict shape as `published_url`, built from the
    project's own draft slug. The draft folder is what the Builder's
    preview already loads from the apps origin by its unguessable slug;
    the worker reads exactly that, so nothing is made readable that was
    not already."""
    origin = settings.apps_origin
    if origin is None:
        raise RenderError("앱 주소(APPS_BASE_URL)가 없어 서버에서 찍을 수 없어요.", 503)
    slug = project.draft_slug or ""
    if project.app_runtime_at is None or not _SLUG.match(slug):
        raise RenderError("미리보기가 아직 없어요.", 409)
    stamp = project.app_runtime_at.isoformat()
    return f"{origin}/{slug}/_app/index.html?v={quote(stamp, safe='')}"


# ------------------------------------------------------------ one render


def render_draft_now(db: Session, settings: Settings, project: BuilderProject) -> None:
    """The working copy's picture (the Builder card), or `RenderError`."""
    renderer = get_renderer(settings)
    if renderer is None:
        raise RenderError(OFF, 503)
    stamp = project.app_runtime_at
    data = renderer.render(draft_url(settings, project))
    try:
        thumbnails.save_draft(db, get_storage(settings), project, data, source=thumbnails.SERVER, taken_of=stamp)
    except AttachmentRefusal as refusal:
        logger.warning("thumbnail worker returned a bad image: %s", refusal)
        raise RenderError(FAILED) from refusal


def render_now(db: Session, settings: Settings, project: BuilderProject) -> None:
    """Render and store the published version's picture, or raise
    `RenderError` — the old picture (or cover) is untouched on failure."""
    renderer = get_renderer(settings)
    if renderer is None:
        raise RenderError(OFF, 503)
    version = project.published_version
    if version is None:
        raise RenderError(NOT_PUBLISHED, 409)
    url = published_url(settings, project)
    data = renderer.render(url)
    try:
        thumbnails.save_version(db, get_storage(settings), project, version, data, source=thumbnails.SERVER)
    except AttachmentRefusal as refusal:
        # The worker sent something that is not a usable image.
        logger.warning("thumbnail worker returned a bad image: %s", refusal)
        raise RenderError(FAILED) from refusal


def render_quietly(db: Session, settings: Settings, project: BuilderProject, kind: str = "published") -> bool:
    """`render_now` / `render_draft_now` for the queue: False instead of an exception."""
    try:
        (render_draft_now if kind == "draft" else render_now)(db, settings, project)
    except RenderError as error:
        logger.info("thumbnail render skipped for project %s: %s", project.id, error)
        return False
    except Exception:  # noqa: BLE001 — a background job must never take the thread down
        logger.exception("thumbnail render failed for project %s", project.id)
        return False
    return True


# ------------------------------------------------------------ the queue


class RenderQueue:
    """One render at a time, in the order 게시 happened.

    A single thread takes project ids off a bounded queue, opens its own
    database session, and renders. The same project waiting twice is
    queued once (the newest publish is what gets rendered either way).
    """

    def __init__(
        self,
        session_factory: Callable[[], Session],
        settings_for: Callable[[], Settings],
        maxsize: int = QUEUE_MAX,
        background: bool = True,
    ) -> None:
        self._session_factory = session_factory
        self._settings_for = settings_for
        #: Tests run jobs by hand with `run_one`; no thread is started.
        self._background = background
        #: (project id, "published" | "draft") — the same project's draft and
        #: published pictures are separate jobs.
        self._queue: queue.Queue[tuple[int, str]] = queue.Queue(maxsize=maxsize)
        self._waiting: set[tuple[int, str]] = set()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self.done = 0
        self.failed = 0
        self.dropped = 0

    def submit(self, project_id: int, kind: str = "published") -> bool:
        """Queue a project's picture; False when it is already waiting or
        the queue is full (logged — the in-browser capture still happened)."""
        job = (project_id, kind)
        with self._lock:
            if job in self._waiting:
                return False
            try:
                self._queue.put_nowait(job)
            except queue.Full:
                self.dropped += 1
                logger.warning("thumbnail render queue full; project %s (%s) not queued", project_id, kind)
                return False
            self._waiting.add(job)
        return True

    def pending(self) -> int:
        return self._queue.qsize()

    def run_one(self, block: bool = True, timeout: float | None = None) -> bool:
        """Take and render one project. False when nothing was waiting."""
        try:
            job = self._queue.get(block=block, timeout=timeout)
        except queue.Empty:
            return False
        with self._lock:
            self._waiting.discard(job)
        try:
            self._render(*job)
        finally:
            self._queue.task_done()
        return True

    def _render(self, project_id: int, kind: str = "published") -> None:
        db = self._session_factory()
        try:
            project = db.get(BuilderProject, project_id)
            if project is None or project.deleted_at is not None:
                return
            if render_quietly(db, self._settings_for(), project, kind):
                db.commit()
                self.done += 1
            else:
                db.rollback()
                self.failed += 1
        except Exception:  # noqa: BLE001 — see render_quietly
            logger.exception("thumbnail render job failed for project %s", project_id)
            db.rollback()
            self.failed += 1
        finally:
            db.close()

    def start(self) -> None:
        """The background thread, started once, on the first submit."""
        if not self._background:
            return
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._loop, name="thumbnail-render", daemon=True)
            self._thread.start()

    def _loop(self) -> None:
        while True:
            self.run_one(block=True)


_queue: RenderQueue | None = None
_queue_lock = threading.Lock()


def shared_queue() -> RenderQueue:
    """The process's one queue (made on first use, with the app's session
    factory and settings)."""
    global _queue
    with _queue_lock:
        if _queue is None:
            from app.core.config import get_settings
            from app.db.session import SessionLocal

            _queue = RenderQueue(SessionLocal, get_settings)
        return _queue


def use_queue(instance: RenderQueue | None) -> None:
    """Tests: the queue `enqueue` fills (None restores the shared one)."""
    global _queue
    with _queue_lock:
        _queue = instance


_PENDING_KEY = "thumbnail_render.pending"


def enqueue_after_commit(db: Session, settings: Settings, project_id: int, kind: str) -> None:
    """`enqueue` once `db` commits (never, if it rolls back) — the job's own
    session must find what this one is about to write. The jobs wait in
    `db.info`; one pair of listeners per session hands them over on commit
    and drops them on rollback (listeners are never removed mid-dispatch)."""
    if get_renderer(settings) is None:
        return
    from sqlalchemy import event

    pending: list = db.info.setdefault(_PENDING_KEY, [])
    if (settings, project_id, kind) not in pending:
        pending.append((settings, project_id, kind))
    if db.info.get(_PENDING_KEY + ".hooked"):
        return
    db.info[_PENDING_KEY + ".hooked"] = True

    def hand_over(session) -> None:
        jobs = list(session.info.get(_PENDING_KEY, []))
        session.info[_PENDING_KEY] = []
        for job_settings, job_project, job_kind in jobs:
            enqueue(job_settings, job_project, job_kind)

    def drop(session, _previous_transaction=None) -> None:
        session.info[_PENDING_KEY] = []

    event.listen(db, "after_commit", hand_over)
    event.listen(db, "after_soft_rollback", drop)


def enqueue(settings: Settings, project_id: int, kind: str = "published") -> bool:
    """After 게시 (`published`) or a new working copy (`draft`,
    draft-server-thumbnails): ask for the picture, in the background. A
    no-op (False) while the renderer is `browser`. Never raises — the
    change has already happened and must answer normally."""
    try:
        if get_renderer(settings) is None:
            return False
        instance = shared_queue()
        queued = instance.submit(project_id, kind)
        if queued:
            instance.start()
        return queued
    except Exception:  # noqa: BLE001 — the in-browser capture still ran
        logger.exception("thumbnail render not queued for project %s", project_id)
        return False
