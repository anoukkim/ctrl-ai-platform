"""thumbnail-render-worker — a real browser on the server photographs a
published app.

What these tests hold: the api asks the worker for one address only (built
from the configuration and the project's own slug, never from a request);
게시 queues a render that runs one at a time in the background and stores
the picture through `thumbnails` like an upload; a failed render keeps the
old picture; Admin › Apps' server render answers 503 with the reason
while the renderer is `browser`; `THUMBNAIL_RENDERER=server` refuses to
start without the worker's address and secret; and the worker's own
checks (loaded from thumbs/worker.py, no browser needed) refuse every
address but the published files on the allowed host and every request
to another host.
"""

from __future__ import annotations

import importlib.util
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.main import app
from app.models import BuilderProject
from app.services import thumbnail_render, thumbnails
from app.services.storage import get_storage
from tests.test_thumbnails import OCTET, picture, publish

APPS_BASE = "http://apps.test"
WORKER = "http://thumbs:8080"
SECRET = "s3cret-for-tests"


@pytest.fixture
def settings_for(tmp_path):
    def make(**overrides) -> Settings:
        values = dict(
            app_env="development",
            chat_mock_delay_ms=0,
            apps_dir=str(tmp_path / "apps"),
            apps_base_url=APPS_BASE,
            storage_dir=str(tmp_path / "storage"),
        )
        values.update(overrides)
        return Settings(**values)

    return make


@pytest.fixture
def server_config(settings_for):
    """The api on `server`, the worker swapped for a fake that records."""
    settings = settings_for(thumbnail_renderer="server", thumbnail_worker_url=WORKER, thumbnail_worker_secret=SECRET)
    app.dependency_overrides[get_settings] = lambda: settings
    renderer = thumbnail_render.FakeRenderer()
    thumbnail_render.use_renderer(renderer)
    yield settings, renderer
    thumbnail_render.use_renderer(None)
    thumbnail_render.use_queue(None)
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def browser_config(settings_for):
    settings = settings_for()
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    thumbnail_render.use_queue(None)
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def project(db_session: Session, dev_user) -> BuilderProject:
    row = BuilderProject(owner_user_id=dev_user.id, name="할 일", description="")
    db_session.add(row)
    db_session.commit()
    return row


def make_queue(db_session: Session, settings: Settings) -> thumbnail_render.RenderQueue:
    """A queue on the test database that runs only when told to."""
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False, expire_on_commit=False)
    instance = thumbnail_render.RenderQueue(factory, lambda: settings, background=False)
    thumbnail_render.use_queue(instance)
    return instance


def stored_size(settings: Settings, project: BuilderProject) -> tuple[int, int]:
    data = thumbnails.load_published(get_storage(settings), project)
    assert data is not None
    return Image.open(io.BytesIO(data)).size


# ------------------------------------------------------------ the address


def test_the_address_is_built_from_the_configuration_and_the_slug_only(db_session, dev_user, settings_for) -> None:
    settings = settings_for()
    project = BuilderProject(owner_user_id=dev_user.id, name="x", description="", app_slug="abcdefgh23")
    db_session.add(project)
    db_session.commit()
    # Not published: nothing to photograph.
    with pytest.raises(thumbnail_render.RenderError) as refused:
        thumbnail_render.published_url(settings, project)
    assert refused.value.status_code == 409

    project.published_version_id = 1
    url = thumbnail_render.published_url(settings, project)
    assert url.startswith("http://apps.test/abcdefgh23/_app/index.html?v=")

    # A slug that is not ten of the alphabet's letters never leaves the api.
    project.app_slug = "../_ctrlai"
    with pytest.raises(thumbnail_render.RenderError):
        thumbnail_render.published_url(settings, project)
    project.app_slug = None
    with pytest.raises(thumbnail_render.RenderError):
        thumbnail_render.published_url(settings, project)

    # Without an apps origin there is no address at all.
    project.app_slug = "abcdefgh23"
    with pytest.raises(thumbnail_render.RenderError) as off:
        thumbnail_render.published_url(settings_for(apps_base_url=""), project)
    assert off.value.status_code == 503


# ------------------------------------------------------------ the worker call


class FakeResponse:
    """What `client.stream(...)` yields: status, headers, a body in chunks."""

    def __init__(self, status_code: int, content: bytes = b"", headers: dict | None = None) -> None:
        self.status_code = status_code
        self.content = content
        self.headers = {"content-type": "image/png", "content-length": str(len(content))}
        if headers is not None:
            self.headers = headers

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        pass

    def iter_bytes(self):
        for start in range(0, len(self.content), 65536):
            yield self.content[start : start + 65536]


class FakeClient:
    def __init__(self, answer, calls: list[dict]) -> None:
        self.answer = answer
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        pass

    def stream(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def test_the_worker_renderer_posts_the_url_with_the_secret_and_reads_a_bounded_png() -> None:
    calls: list[dict] = []
    png = picture(1024, 640)
    renderer = thumbnail_render.WorkerRenderer(
        WORKER + "/", SECRET, timeout_s=20, client_factory=lambda: FakeClient(FakeResponse(200, png), calls)
    )
    assert renderer.render("http://apps.test/abcdefgh23/_app/index.html") == png
    assert calls[0]["method"] == "POST" and calls[0]["url"] == "http://thumbs:8080/render"
    assert calls[0]["json"] == {"url": "http://apps.test/abcdefgh23/_app/index.html", "timeout_s": 20}
    assert calls[0]["headers"] == {thumbnail_render.SECRET_HEADER: SECRET}


def test_the_real_client_uses_the_unix_socket_and_one_deadline_for_every_phase() -> None:
    import httpx2 as httpx

    over_socket = thumbnail_render.WorkerRenderer("http://thumbs", SECRET, timeout_s=20, socket_path="/run/thumbs/t.sock")
    client = over_socket._client()
    assert isinstance(client, httpx.Client)
    assert client.timeout == httpx.Timeout(25)
    client.close()
    assert thumbnail_render.WorkerRenderer(WORKER, SECRET, timeout_s=20)._client().timeout == httpx.Timeout(25)


@pytest.mark.parametrize(
    "answer",
    [
        FakeResponse(503, b'{"detail":"busy"}', {"content-type": "application/json", "content-length": "17"}),
        FakeResponse(200, b""),
        # Says PNG, is too big (the length header): refused before a byte is read.
        FakeResponse(200, b"x", {"content-type": "image/png", "content-length": str(thumbnail_render.MAX_IMAGE_BYTES + 1)}),
        # Lies about its length: refused while reading, past the cap.
        FakeResponse(200, b"x" * (thumbnail_render.MAX_IMAGE_BYTES + 1), {"content-type": "image/png", "content-length": "10"}),
        # No length at all.
        FakeResponse(200, b"x" * 10, {"content-type": "image/png"}),
        # Not an image.
        FakeResponse(200, b"<html>", {"content-type": "text/html", "content-length": "6"}),
        ConnectionError("down"),
    ],
)
def test_a_failed_worker_answer_is_a_render_error(answer) -> None:
    renderer = thumbnail_render.WorkerRenderer(WORKER, SECRET, client_factory=lambda: FakeClient(answer, []))
    with pytest.raises(thumbnail_render.RenderError):
        renderer.render("http://apps.test/abcdefgh23/_app/index.html")


# ------------------------------------------------------------ 게시 → the queue


def test_publishing_queues_a_render_that_stores_the_version_picture(
    client: TestClient, db_session: Session, budgeted, project, server_config
) -> None:
    settings, renderer = server_config
    queue = make_queue(db_session, settings)

    publish(client, project)
    db_session.refresh(project)
    assert project.published_thumbnail_at is None
    # The new working copy (draft-server-thumbnails) and the 게시.
    assert queue.pending() == 2
    assert renderer.urls == []

    assert queue.run_one(block=False) is True  # the draft
    assert queue.run_one(block=False) is True  # the published version
    assert renderer.urls[-1] == thumbnail_render.published_url(settings, project)
    db_session.expire_all()
    assert project.published_thumbnail_at is not None
    # The worker's 1024×640 PNG went through `thumbnails.encode`: 640×400.
    assert stored_size(settings, project) == (thumbnails.WIDTH, thumbnails.HEIGHT)
    assert queue.done == 2 and queue.failed == 0
    assert queue.run_one(block=False) is False
    # CtrlAIApps serves it like any upload.
    served = client.get(f"/api/apps/{project.app_slug}/thumbnail")
    assert served.status_code == 200 and served.headers["content-type"] == thumbnails.MEDIA_TYPE


def test_a_failed_render_keeps_the_old_picture(
    client: TestClient, db_session: Session, budgeted, project, server_config
) -> None:
    settings, renderer = server_config
    queue = make_queue(db_session, settings)
    publish(client, project)
    # The maker's browser already uploaded one (the fallback).
    uploaded = client.post(
        f"/api/builder/projects/{project.id}/thumbnail?space=published", content=picture(), headers=OCTET
    )
    assert uploaded.status_code == 200, uploaded.text
    before = uploaded.json()["published_thumbnail_at"]
    before_bytes = thumbnails.load_published(get_storage(settings), project)

    renderer.fail = True
    assert queue.run_one(block=False) is True
    assert queue.run_one(block=False) is True
    assert queue.failed == 2
    db_session.expire_all()
    assert client.get(f"/api/builder/projects/{project.id}").json()["published_thumbnail_at"] == before
    assert thumbnails.load_published(get_storage(settings), project) == before_bytes


def test_the_queue_runs_one_at_a_time_and_never_piles_up(db_session: Session, settings_for) -> None:
    settings = settings_for(thumbnail_renderer="server", thumbnail_worker_url=WORKER, thumbnail_worker_secret=SECRET)
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False, expire_on_commit=False)
    queue = thumbnail_render.RenderQueue(factory, lambda: settings, maxsize=2, background=False)
    assert queue.submit(1) is True
    assert queue.submit(1) is False  # already waiting
    assert queue.submit(2) is True
    assert queue.submit(3) is False  # full: dropped, not blocking 게시
    assert queue.dropped == 1 and queue.pending() == 2
    # Unknown projects are skipped quietly; the queue keeps going.
    assert queue.run_one(block=False) is True
    assert queue.run_one(block=False) is True
    assert queue.run_one(block=False) is False
    assert queue.done == 0 and queue.failed == 0


def test_in_browser_mode_publishing_queues_nothing(
    client: TestClient, db_session: Session, budgeted, project, browser_config
) -> None:
    queue = make_queue(db_session, browser_config)
    publish(client, project)
    assert queue.pending() == 0
    assert thumbnail_render.get_renderer(browser_config) is None


# ------------------------------------------------------------ Admin › Apps


def test_admin_render_answers_503_while_the_renderer_is_the_browser(
    client: TestClient, db_session: Session, budgeted, project, browser_config
) -> None:
    publish(client, project)
    assert client.get("/api/admin/apps/thumbnail-renderer").json() == {"renderer": "browser"}
    answer = client.post(f"/api/admin/apps/{project.id}/thumbnail/render", json={})
    assert answer.status_code == 503, answer.text
    assert answer.json()["detail"] == thumbnail_render.OFF


def test_admin_render_photographs_on_the_server_one_app_at_a_time(
    client: TestClient, db_session: Session, budgeted, project, server_config
) -> None:
    settings, renderer = server_config
    make_queue(db_session, settings)
    assert client.get("/api/admin/apps/thumbnail-renderer").json() == {"renderer": "server"}

    # Before 게시: nothing to photograph.
    assert client.post(f"/api/admin/apps/{project.id}/thumbnail/render", json={}).status_code == 409
    publish(client, project)

    answer = client.post(f"/api/admin/apps/{project.id}/thumbnail/render", json={})
    assert answer.status_code == 200, answer.text
    assert answer.json()["thumbnail_at"] is not None
    assert renderer.urls[-1] == thumbnail_render.published_url(settings, project)
    assert stored_size(settings, project) == (thumbnails.WIDTH, thumbnails.HEIGHT)
    first = answer.json()["thumbnail_at"]

    # A failing worker: 503 with the reason, the picture untouched.
    renderer.fail = True
    failed = client.post(f"/api/admin/apps/{project.id}/thumbnail/render", json={})
    assert failed.status_code == 503
    assert failed.json()["detail"] == thumbnail_render.FAILED
    assert client.get(f"/api/admin/apps/{project.id}").json()["thumbnail_at"] == first

    # The JSON-body rule holds; a deleted project is a 404.
    assert (
        client.post(
            f"/api/admin/apps/{project.id}/thumbnail/render", content="x", headers={"Content-Type": "text/plain"}
        ).status_code
        in (415, 422)
    )
    assert client.post("/api/admin/apps/999/thumbnail/render", json={}).status_code == 404


# ------------------------------------------------------------ the switch


def test_server_mode_refuses_to_start_without_the_worker_address_and_secret() -> None:
    assert thumbnail_render.mode(Settings(thumbnail_renderer="Browser")) == "browser"
    missing = Settings(thumbnail_renderer="server").missing_provider_settings()
    assert "THUMBNAIL_WORKER_URL" in missing and "THUMBNAIL_WORKER_SECRET" in missing
    assert Settings(
        thumbnail_renderer="server", thumbnail_worker_url=WORKER, thumbnail_worker_secret=SECRET
    ).missing_provider_settings() == []
    assert "THUMBNAIL_RENDERER (browser 또는 server)" in Settings(thumbnail_renderer="chrome").missing_provider_settings()
    assert not [name for name in Settings().missing_provider_settings() if name.startswith("THUMBNAIL")]
    assert isinstance(
        thumbnail_render.get_renderer(
            Settings(thumbnail_renderer="server", thumbnail_worker_url=WORKER, thumbnail_worker_secret=SECRET)
        ),
        thumbnail_render.WorkerRenderer,
    )


# ------------------------------------------------------------ the worker's own checks


@pytest.fixture(scope="module")
def worker():
    """thumbs/worker.py as a module — its checks need no browser."""
    path = Path(__file__).resolve().parents[2] / "thumbs" / "worker.py"
    spec = importlib.util.spec_from_file_location("thumbs_worker", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_the_worker_opens_only_the_published_files_on_the_allowed_host(worker) -> None:
    ok = "https://apps.ctrlai.my/abcdefgh23/_app/index.html?v=2026-10-17T00%3A00%3A00"
    assert worker.check_url(ok, "apps.ctrlai.my") == ok
    for bad in [
        "https://ctrlai.my/abcdefgh23/_app/index.html",  # the site
        "https://apps.ctrlai.my.evil.example/abcdefgh23/_app/index.html",
        "https://apps.ctrlai.my:8443/abcdefgh23/_app/index.html",  # another port
        "https://user@apps.ctrlai.my/abcdefgh23/_app/index.html",  # userinfo
        "http://apps.ctrlai.my/abcdefgh23/_app/index.html",  # plain http in production
        "https://apps.ctrlai.my/abcdefgh23/",  # the shell, not the files
        "https://apps.ctrlai.my/abcdefgh23/_app/other.html",
        "https://apps.ctrlai.my/_ctrlai/shell/abcdefgh23",
        "https://apps.ctrlai.my/abcdefgh23/_app/index.html#x",
        "https://apps.ctrlai.my/ABCDEFGH23/_app/index.html",
        "file:///etc/passwd",
        "https://apps.ctrlai.my/" + "a" * 600,
        42,
    ]:
        with pytest.raises(worker.Refusal):
            worker.check_url(bad, "apps.ctrlai.my")
    # Development: plain http on localhost with a port.
    dev = "http://localhost:9000/abcdefgh23/_app/index.html"
    assert worker.check_url(dev, "localhost:9000", allow_http=True) == dev
    with pytest.raises(worker.Refusal):
        worker.check_url(dev, "localhost:9000")


def test_the_browser_may_reach_the_allowed_host_and_nothing_else(worker) -> None:
    assert worker.resolver_rules("apps.ctrlai.my") == "MAP * ~NOTFOUND, EXCLUDE apps.ctrlai.my"
    assert worker.resolver_rules("localhost:9000") == "MAP * ~NOTFOUND, EXCLUDE localhost"
    # On the server the allowed host goes to caddy's fixed address on the
    # internal network — first rule wins — and nothing else resolves.
    assert worker.resolver_rules("apps.ctrlai.my", "172.30.88.2") == "MAP apps.ctrlai.my 172.30.88.2, MAP * ~NOTFOUND"
    assert "--host-resolver-rules=MAP apps.ctrlai.my 172.30.88.2, MAP * ~NOTFOUND" in worker.launch_args(
        "apps.ctrlai.my", "172.30.88.2"
    )
    args = worker.launch_args("apps.ctrlai.my")
    assert "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE apps.ctrlai.my" in args
    assert "--webrtc-ip-handling-policy=disable_non_proxied_udp" in args
    assert "--force-webrtc-ip-handling-policy" in args
    allowed = worker.request_allowed
    assert allowed("https://apps.ctrlai.my/abcdefgh23/_app/app.js", "apps.ctrlai.my")
    assert allowed("https://apps.ctrlai.my/_ctrlai/sdk.js", "apps.ctrlai.my")
    assert allowed("data:image/png;base64,AAAA", "apps.ctrlai.my")
    assert allowed("blob:https://apps.ctrlai.my/1234", "apps.ctrlai.my")
    for blocked in [
        "http://api:8000/api/health",
        "http://172.18.0.2:8000/api/health",  # an IP written into the page
        "https://ctrlai.my/api/health",
        "https://evil.example/x",
        # WebSockets never reach the HTTP route: `render` closes them with
        # a WebSocket route and the files' CSP refuses them — this gate
        # would refuse the scheme as well.
        "ws://apps.ctrlai.my/socket",
        "ftp://apps.ctrlai.my/x",
    ]:
        assert not allowed(blocked, "apps.ctrlai.my"), blocked
    # The sandbox stays on unless development says otherwise.
    import os

    env = dict(
        os.environ,
        THUMBS_SECRET="x",
        THUMBS_ALLOWED_HOST="apps.ctrlai.my",
        THUMBS_SOCKET="/run/thumbs/t.sock",
        THUMBS_RESOLVE_TO="172.30.88.2",
    )
    env.pop("THUMBS_NO_SANDBOX", None)
    os.environ.update(env)
    try:
        cfg = worker.config()
    finally:
        for name in ("THUMBS_SECRET", "THUMBS_ALLOWED_HOST", "THUMBS_SOCKET", "THUMBS_RESOLVE_TO"):
            os.environ.pop(name, None)
    assert cfg["sandbox"] is True and cfg["socket"] == "/run/thumbs/t.sock" and cfg["resolve_to"] == "172.30.88.2"


# ------------------------------------------------------------ draft-server-thumbnails


def test_a_new_working_copy_is_photographed_from_its_own_draft_address(
    client: TestClient, db_session: Session, budgeted, project, server_config
) -> None:
    settings, renderer = server_config
    queue = make_queue(db_session, settings)
    generated = client.post(
        f"/api/builder/projects/{project.id}/generate", json={"request": "할 일 앱을 만들어 줘", "style": ""}
    )
    assert generated.status_code == 200, generated.text
    assert queue.pending() == 1
    assert queue.run_one(block=False) is True
    db_session.expire_all()
    fresh = db_session.get(BuilderProject, project.id)
    url = renderer.urls[-1]
    # Built from the project's own draft slug, the files path only.
    assert url == thumbnail_render.draft_url(settings, fresh)
    assert url.startswith(f"{APPS_BASE}/{fresh.draft_slug}/_app/index.html?v=")
    assert fresh.draft_thumbnail_at is not None
    stored = thumbnails.load_draft(get_storage(settings), fresh)
    assert Image.open(io.BytesIO(stored)).size == (thumbnails.WIDTH, thumbnails.HEIGHT)


def test_the_draft_address_is_refused_without_a_written_copy_or_with_a_bad_slug(
    db_session: Session, dev_user, settings_for
) -> None:
    settings = settings_for()
    row = BuilderProject(owner_user_id=dev_user.id, name="x", description="", draft_slug="abcdefgh23")
    db_session.add(row)
    db_session.commit()
    with pytest.raises(thumbnail_render.RenderError):  # not written yet
        thumbnail_render.draft_url(settings, row)
    from datetime import datetime, timezone

    row.app_runtime_at = datetime.now(timezone.utc)
    assert thumbnail_render.draft_url(settings, row).startswith("http://apps.test/abcdefgh23/_app/index.html?v=")
    row.draft_slug = "../x"
    with pytest.raises(thumbnail_render.RenderError):
        thumbnail_render.draft_url(settings, row)


def test_in_browser_mode_a_new_working_copy_queues_nothing(
    client: TestClient, db_session: Session, budgeted, project, browser_config
) -> None:
    queue = make_queue(db_session, browser_config)
    client.post(f"/api/builder/projects/{project.id}/generate", json={"request": "할 일 앱", "style": ""})
    assert queue.pending() == 0


def test_draft_and_published_jobs_of_one_project_are_separate(db_session: Session, settings_for) -> None:
    settings = settings_for(thumbnail_renderer="server", thumbnail_worker_url=WORKER, thumbnail_worker_secret=SECRET)
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False, expire_on_commit=False)
    queue = thumbnail_render.RenderQueue(factory, lambda: settings, background=False)
    assert queue.submit(1, "draft") is True
    assert queue.submit(1, "published") is True
    assert queue.submit(1, "draft") is False
    assert queue.pending() == 2


def test_the_worker_waits_for_fonts_and_stays_inside_the_deadline(worker) -> None:
    assert worker.SETTLE_MS >= 1000 and worker.FONTS_MS <= 5000
    import inspect

    source = inspect.getsource(worker.render)
    assert "document.fonts.status" in source
    # launch + nav + fonts + settle + screenshot fit in timeout_s + 5, at the
    # default and at the smallest timeout the worker accepts (10 s).
    for timeout_s in (worker.DEFAULT_TIMEOUT_S, 10):
        fixed = worker.LAUNCH_MS + worker.FONTS_MS + worker.SETTLE_MS + worker.SHOT_MS
        nav = max(3000, (timeout_s + 5) * 1000 - fixed)
        assert nav + fixed <= (timeout_s + 5) * 1000, timeout_s


def test_a_draft_job_is_queued_only_after_the_commit_and_finds_a_first_draft(
    db_session: Session, dev_user, settings_for, monkeypatch
) -> None:
    from datetime import datetime, timezone

    settings = settings_for(thumbnail_renderer="server", thumbnail_worker_url=WORKER, thumbnail_worker_secret=SECRET)
    renderer = thumbnail_render.FakeRenderer()
    thumbnail_render.use_renderer(renderer)
    try:
        queue = make_queue(db_session, settings)
        row = BuilderProject(owner_user_id=dev_user.id, name="새 앱", description="")
        db_session.add(row)
        db_session.flush()
        row.draft_slug = "abcdefgh23"
        row.app_runtime_at = datetime.now(timezone.utc)
        thumbnail_render.enqueue_after_commit(db_session, settings, row.id, "draft")
        assert queue.pending() == 0  # not before the commit
        db_session.commit()
        assert queue.pending() == 1
        assert queue.run_one(block=False) is True
        assert queue.done == 1 and renderer.urls[-1].startswith(f"{APPS_BASE}/abcdefgh23/_app/index.html")
        # A rolled-back change queues nothing.
        row.name = "되돌릴 이름"
        db_session.flush()
        thumbnail_render.enqueue_after_commit(db_session, settings, row.id, "draft")
        db_session.rollback()
        db_session.commit()
        assert queue.pending() == 0
    finally:
        thumbnail_render.use_renderer(None)
        thumbnail_render.use_queue(None)


# ------------------------------------------------------------ fix-draft-thumbs


def test_the_font_wait_is_a_function_so_the_files_csp_does_not_refuse_it(worker) -> None:
    """Playwright polls an *expression* with eval(); the app files' CSP has
    no 'unsafe-eval', so every app whose fonts were still loading at `load`
    failed with 502. A function is sent over the protocol instead."""
    import inspect
    import re

    source = inspect.getsource(worker.render)
    calls = re.findall(r"wait_for_function\(\s*\"([^\"]*)\"", source)
    assert calls and all(call.lstrip().startswith("() =>") for call in calls), calls


def test_the_api_logs_the_workers_reason_for_a_failed_page(caplog) -> None:
    body = b'{"detail": "page failed: Error: Page.goto: net::ERR_ABORTED"}'
    answer = FakeResponse(502, body, {"content-type": "application/json", "content-length": str(len(body))})
    renderer = thumbnail_render.WorkerRenderer(WORKER, SECRET, client_factory=lambda: FakeClient(answer, []))
    with caplog.at_level("WARNING"), pytest.raises(thumbnail_render.RenderError):
        renderer.render("http://apps.test/abcdefgh23/_app/index.html")
    assert "502: page failed: Error: Page.goto: net::ERR_ABORTED" in caplog.text


def red_picture() -> bytes:
    """Unlike `picture()` (and the fake worker's PNG), so a replaced file shows."""
    out = io.BytesIO()
    Image.new("RGB", (1280, 800), (220, 40, 40)).save(out, format="PNG")
    return out.getvalue()


def _draft_bytes(settings: Settings, project_id: int, db_session: Session) -> tuple[bytes | None, str | None]:
    db_session.expire_all()
    row = db_session.get(BuilderProject, project_id)
    return thumbnails.load_draft(get_storage(settings), row), row.draft_thumbnail_source


def test_while_the_server_renders_a_browser_draft_upload_keeps_a_current_server_picture(
    client: TestClient, db_session: Session, budgeted, project, server_config
) -> None:
    settings, _renderer = server_config
    queue = make_queue(db_session, settings)
    generated = client.post(
        f"/api/builder/projects/{project.id}/generate", json={"request": "할 일 앱을 만들어 줘", "style": ""}
    )
    assert generated.status_code == 200, generated.text
    assert queue.run_one(block=False) is True
    server_bytes, source = _draft_bytes(settings, project.id, db_session)
    assert server_bytes is not None and source == thumbnails.SERVER

    # The preview loads and the in-browser capture uploads: accepted, ignored.
    uploaded = client.post(
        f"/api/builder/projects/{project.id}/thumbnail?space=draft", content=red_picture(), headers=OCTET
    )
    assert uploaded.status_code == 200, uploaded.text
    assert _draft_bytes(settings, project.id, db_session) == (server_bytes, thumbnails.SERVER)

    # The working copy changes and the server's picture is not ready (or its
    # render failed): the browser's picture is the fallback until it is.
    from datetime import datetime, timedelta, timezone

    from app.services.quiet import quiet_update

    row = db_session.get(BuilderProject, project.id)
    quiet_update(db_session, row, app_runtime_at=datetime.now(timezone.utc) + timedelta(seconds=5))
    db_session.commit()
    uploaded = client.post(
        f"/api/builder/projects/{project.id}/thumbnail?space=draft", content=red_picture(), headers=OCTET
    )
    assert uploaded.status_code == 200, uploaded.text
    browser_bytes, source = _draft_bytes(settings, project.id, db_session)
    assert source == thumbnails.BROWSER and browser_bytes != server_bytes


def test_in_browser_mode_the_browser_draft_upload_replaces_any_picture(
    client: TestClient, db_session: Session, budgeted, project, browser_config
) -> None:
    from datetime import datetime, timezone

    from app.services.quiet import quiet_update

    storage = get_storage(browser_config)
    thumbnails.save_draft(db_session, storage, project, picture(), source=thumbnails.SERVER)
    quiet_update(db_session, project, app_runtime_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    db_session.commit()
    before, _ = _draft_bytes(browser_config, project.id, db_session)
    uploaded = client.post(
        f"/api/builder/projects/{project.id}/thumbnail?space=draft", content=red_picture(), headers=OCTET
    )
    assert uploaded.status_code == 200, uploaded.text
    after, source = _draft_bytes(browser_config, project.id, db_session)
    assert source == thumbnails.BROWSER and after != before


def test_while_the_server_renders_a_browser_upload_keeps_the_servers_published_picture(
    client: TestClient, db_session: Session, budgeted, project, server_config
) -> None:
    settings, _renderer = server_config
    queue = make_queue(db_session, settings)
    publish(client, project)
    assert queue.run_one(block=False) is True
    assert queue.run_one(block=False) is True
    db_session.expire_all()
    stamp = client.get(f"/api/builder/projects/{project.id}").json()["published_thumbnail_at"]
    before = thumbnails.load_published(get_storage(settings), project)
    assert before is not None and project.published_version.thumbnail_source == thumbnails.SERVER

    uploaded = client.post(
        f"/api/builder/projects/{project.id}/thumbnail?space=published", content=red_picture(), headers=OCTET
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["published_thumbnail_at"] == stamp
    assert thumbnails.load_published(get_storage(settings), project) == before


def test_a_server_picture_of_older_files_does_not_block_the_browser(
    db_session: Session, dev_user, settings_for
) -> None:
    """The render finished after the next edit: it is stamped with the files
    it photographed, so the browser's capture of the new files is stored."""
    from datetime import datetime, timedelta, timezone

    settings = settings_for(thumbnail_renderer="server", thumbnail_worker_url=WORKER, thumbnail_worker_secret=SECRET)
    first = datetime.now(timezone.utc)
    row = BuilderProject(
        owner_user_id=dev_user.id, name="x", description="", draft_slug="abcdefgh23", app_runtime_at=first
    )
    db_session.add(row)
    db_session.commit()

    class EditsMidRender(thumbnail_render.FakeRenderer):
        def render(self, url: str) -> bytes:
            data = super().render(url)
            row.app_runtime_at = first + timedelta(seconds=3)  # the member's next edit
            db_session.flush()
            return data

    thumbnail_render.use_renderer(EditsMidRender())
    try:
        thumbnail_render.render_draft_now(db_session, settings, row)
        db_session.commit()
    finally:
        thumbnail_render.use_renderer(None)
    db_session.refresh(row)
    assert row.draft_thumbnail_source == thumbnails.SERVER
    assert row.draft_thumbnail_at.replace(tzinfo=None) == first.replace(tzinfo=None)
    assert thumbnails.browser_may_replace_draft(row, server_on=True) is True


def test_the_browser_rule_without_a_picture_or_without_written_files(db_session: Session, dev_user) -> None:
    from datetime import datetime, timezone

    row = BuilderProject(owner_user_id=dev_user.id, name="x", description="")
    assert thumbnails.browser_may_replace_draft(row, server_on=True) is True  # no picture yet
    row.draft_thumbnail_at = datetime.now(timezone.utc)
    row.draft_thumbnail_source = thumbnails.SERVER
    row.app_runtime_at = None  # files removed (deleted, then restored)
    assert thumbnails.browser_may_replace_draft(row, server_on=True) is True
    row.app_runtime_at = row.draft_thumbnail_at
    assert thumbnails.browser_may_replace_draft(row, server_on=True) is False
    assert thumbnails.browser_may_replace_draft(row, server_on=False) is True
