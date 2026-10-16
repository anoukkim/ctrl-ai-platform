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
    def __init__(self, status_code: int, content: bytes = b"") -> None:
        self.status_code = status_code
        self.content = content


def test_the_worker_renderer_posts_the_url_with_the_secret_and_a_bounded_timeout() -> None:
    calls: list[dict] = []
    png = picture(1024, 640)

    def post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return FakeResponse(200, png)

    renderer = thumbnail_render.WorkerRenderer(WORKER + "/", SECRET, timeout_s=20, post=post)
    assert renderer.render("http://apps.test/abcdefgh23/_app/index.html") == png
    assert calls[0]["url"] == "http://thumbs:8080/render"
    assert calls[0]["json"] == {"url": "http://apps.test/abcdefgh23/_app/index.html", "timeout_s": 20}
    assert calls[0]["headers"] == {thumbnail_render.SECRET_HEADER: SECRET}
    assert calls[0]["timeout"] == 25


@pytest.mark.parametrize(
    "answer",
    [
        FakeResponse(503, b'{"detail":"busy"}'),
        FakeResponse(200, b""),
        FakeResponse(200, b"x" * (thumbnail_render.MAX_IMAGE_BYTES + 1)),
        ConnectionError("down"),
    ],
)
def test_a_failed_worker_answer_is_a_render_error(answer) -> None:
    def post(url, **kwargs):
        if isinstance(answer, Exception):
            raise answer
        return answer

    renderer = thumbnail_render.WorkerRenderer(WORKER, SECRET, post=post)
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
    assert queue.pending() == 1
    assert renderer.urls == []

    assert queue.run_one(block=False) is True
    assert renderer.urls == [thumbnail_render.published_url(settings, project)]
    db_session.expire_all()
    assert project.published_thumbnail_at is not None
    # The worker's 1024×640 PNG went through `thumbnails.encode`: 640×400.
    assert stored_size(settings, project) == (thumbnails.WIDTH, thumbnails.HEIGHT)
    assert queue.done == 1 and queue.failed == 0
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
    assert queue.failed == 1
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
        "ws://apps.ctrlai.my/socket",
        "ftp://apps.ctrlai.my/x",
    ]:
        assert not allowed(blocked, "apps.ctrlai.my"), blocked
