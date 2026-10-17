"""thumbnail-choice (owner, 2026-10-17) — the maker chooses the thumbnail.

"썸네일 지정 (원래는 기본으로 렌더링 된 값을 넣고) 지정을 하면 … 비율
고정된걸로 캡쳐해서 넣을 수 있게". The Builder frames 16:10 of the
미리보기 and uploads those pixels (or a pasted screenshot); the server
checks and re-encodes them like every upload. While chosen, the Builder
card and CtrlAIApps show it and no automatic picture — the server's
render or the browser's capture — replaces it; 자동으로 되돌리기 brings the
automatic one back.
"""

from __future__ import annotations

import io

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from app.models import BuilderProject
from app.services import thumbnail_render, thumbnails
from app.services.storage import get_storage
from tests.conftest import MEMBER_PASSWORD
from tests.test_thumbnails import OCTET, _sign_in, config, picture, project, publish  # noqa: F401 — fixtures


def coloured(rgb: tuple[int, int, int]) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (1280, 800), rgb).save(out, format="PNG")
    return out.getvalue()


def centre(data: bytes) -> tuple[int, int, int]:
    with Image.open(io.BytesIO(data)) as image:
        return image.convert("RGB").getpixel((320, 200))


def near(a: tuple[int, int, int], b: tuple[int, int, int]) -> bool:
    return all(abs(x - y) <= 8 for x, y in zip(a, b))


RED, BLUE, GREEN = (220, 40, 40), (40, 60, 220), (40, 180, 60)


def test_a_chosen_picture_shows_on_the_card_until_reset(
    client: TestClient, db_session: Session, project, participating, config
) -> None:
    base = f"/api/builder/projects/{project.id}"
    # The automatic picture (the browser's capture here).
    assert client.post(f"{base}/thumbnail", content=coloured(BLUE), headers=OCTET).status_code == 200
    assert near(centre(client.get(f"{base}/thumbnail").content), BLUE)

    chosen = client.post(f"{base}/thumbnail/choice", content=coloured(RED), headers=OCTET)
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["thumbnail_chosen_at"] is not None
    served = client.get(f"{base}/thumbnail")
    assert served.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(served.content)) as image:
        assert image.size == (thumbnails.WIDTH, thumbnails.HEIGHT)
    assert near(centre(served.content), RED)

    # Automatic pictures keep arriving; the chosen one stays.
    assert client.post(f"{base}/thumbnail", content=coloured(GREEN), headers=OCTET).status_code == 200
    assert near(centre(client.get(f"{base}/thumbnail").content), RED)

    # 자동으로 되돌리기: the newest automatic picture shows again.
    reset = client.post(f"{base}/thumbnail/choice/reset", json={})
    assert reset.status_code == 200 and reset.json()["thumbnail_chosen_at"] is None
    assert near(centre(client.get(f"{base}/thumbnail").content), GREEN)
    assert not get_storage(config).exists(thumbnails.chosen_key(project))


def test_a_chosen_picture_is_what_ctrlaiapps_shows_once_published(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    base = f"/api/builder/projects/{project.id}"
    publish(client, project)
    db_session.refresh(project)
    assert client.post(f"{base}/thumbnail?space=published", content=coloured(BLUE), headers=OCTET).status_code == 200
    chosen = client.post(f"{base}/thumbnail/choice", content=coloured(RED), headers=OCTET).json()
    # The listing's stamp moves, so cached pictures are fetched again.
    assert chosen["published_thumbnail_at"] == chosen["thumbnail_chosen_at"]
    assert client.get(f"/api/apps/{project.app_slug}").json()["thumbnail_at"] == chosen["thumbnail_chosen_at"]
    assert near(centre(client.get(f"/api/apps/{project.app_slug}/thumbnail").content), RED)
    client.post(f"{base}/thumbnail/choice/reset", json={})
    assert near(centre(client.get(f"/api/apps/{project.app_slug}/thumbnail").content), BLUE)


def test_a_server_render_never_replaces_a_chosen_picture(
    client: TestClient, db_session: Session, project, participating, config
) -> None:
    from datetime import datetime, timezone

    base = f"/api/builder/projects/{project.id}"
    assert client.post(f"{base}/thumbnail/choice", content=coloured(RED), headers=OCTET).status_code == 200
    db_session.expire_all()
    row = db_session.get(BuilderProject, project.id)
    row.draft_slug = "abcdefgh23"
    row.app_runtime_at = datetime.now(timezone.utc)
    db_session.commit()
    thumbnail_render.use_renderer(thumbnail_render.FakeRenderer(image=coloured(GREEN)))
    try:
        thumbnail_render.render_draft_now(db_session, config, row)
        db_session.commit()
    finally:
        thumbnail_render.use_renderer(None)
    assert near(centre(client.get(f"{base}/thumbnail").content), RED)


def test_the_choice_is_checked_like_every_upload_and_is_the_owners_only(
    client: TestClient, db_session: Session, project, participating, other_user, config
) -> None:
    url = f"/api/builder/projects/{project.id}/thumbnail/choice"
    assert client.post(url, content=b"<svg/>", headers=OCTET).status_code == 400
    assert client.post(url, content=picture(), headers={"Content-Type": "text/plain"}).status_code == 415
    too_big = client.post(url, content=b"\x89PNG\r\n\x1a\n" + b"\x00" * (thumbnails.MAX_UPLOAD_BYTES + 1), headers=OCTET)
    assert too_big.status_code == 413
    # The reset needs a JSON body like every write.
    assert client.post(f"{url}/reset", content=b"", headers={"Content-Type": "text/plain"}).status_code in (415, 422)
    assert client.get(f"/api/builder/projects/{project.id}").json()["thumbnail_chosen_at"] is None

    _sign_in(client, other_user.username, MEMBER_PASSWORD)
    assert client.post(url, content=picture(), headers=OCTET).status_code in (403, 404)
    assert client.post(f"{url}/reset", json={}).status_code in (403, 404)


def test_the_purge_takes_the_projects_pictures(db_session: Session, project) -> None:
    keys = thumbnails.storage_keys(project.id, [1, 2])
    assert thumbnails.chosen_key(project) in keys and thumbnails.draft_key(project) in keys
    assert thumbnails.version_key_for(project.id, 2) in keys
