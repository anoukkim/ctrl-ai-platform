"""builder-images (1) — reference pictures for 만들기 / 고치기.

A picture is uploaded from the request box (bytes checked, re-encoded,
metadata gone), waits with the project, and the next plan takes it for
that run: the plan call and every file call carry it as an image block
and are billed for it; the self-check does not. It is never a file of the
app. Owner only; ✕ removes a waiting one; purge and withdrawal remove the
bytes.
"""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from app.models import BuilderProject, BuilderReference, UsageEvent
from app.services import builder_references, builder_stages, builder_versions
from app.services.storage import get_storage
from tests.conftest import MEMBER_PASSWORD
from tests.test_builder_stages import config, plan, run  # noqa: F401 — the fixture

OCTET = {"Content-Type": "application/octet-stream"}


@pytest.fixture
def project(db_session: Session, dev_user) -> BuilderProject:
    row = BuilderProject(owner_user_id=dev_user.id, name="카페 메뉴", description="")
    db_session.add(row)
    db_session.commit()
    return row


def picture(width: int = 2400, height: int = 1600, fmt: str = "JPEG", **save) -> bytes:
    image = Image.new("RGB", (width, height), (200, 120, 40))
    out = io.BytesIO()
    image.save(out, format=fmt, **save)
    return out.getvalue()


def upload(client: TestClient, project: BuilderProject, data: bytes, name: str = "ref.jpg"):
    return client.post(f"/api/builder/projects/{project.id}/references?name={name}", content=data, headers=OCTET)


# ------------------------------------------------------------ upload


def test_a_picture_is_checked_reencoded_and_waits_in_the_request_box(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    # A JPEG with EXIF: stored smaller, with no metadata.
    exif = Image.Exif()
    exif[0x010F] = "Phone maker"
    uploaded = upload(client, project, picture(exif=exif.tobytes()))
    assert uploaded.status_code == 201, uploaded.text
    body = uploaded.json()
    assert max(body["width"], body["height"]) == builder_references.LONG_EDGE
    assert body["tokens"] > 0
    stored = get_storage(config).load(f"builder-ref/{project.id}/{body['id']}")
    with Image.open(io.BytesIO(stored)) as image:
        assert not image.getexif()
    # It waits, listed for the request box, and is served to its owner.
    listed = client.get(f"/api/builder/projects/{project.id}/references").json()
    assert [row["id"] for row in listed] == [body["id"]]
    served = client.get(f"/api/builder/projects/{project.id}/references/{body['id']}/file")
    assert served.status_code == 200 and served.headers["content-type"].startswith("image/")
    # Never a file of the app.
    assert builder_versions.current_files(db_session, project) == {}


def test_only_pictures_at_most_three_and_json_never(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    refused = upload(client, project, b"<svg xmlns='http://www.w3.org/2000/svg'/>", "x.svg")
    assert refused.status_code == 400 and "사진만" in refused.json()["detail"]
    assert upload(client, project, b"not an image at all", "x.png").status_code == 400
    for _ in range(3):
        assert upload(client, project, picture(300, 200, "PNG"), "a.png").status_code == 201
    fourth = upload(client, project, picture(300, 200, "PNG"), "a.png")
    assert fourth.status_code == 400 and "3장" in fourth.json()["detail"]
    # The upload is the octet-stream exception; text/plain is refused.
    assert (
        client.post(
            f"/api/builder/projects/{project.id}/references", content=b"x", headers={"Content-Type": "text/plain"}
        ).status_code
        in (415, 422)
    )


def test_another_member_sees_nothing_and_cannot_remove(
    client: TestClient, db_session: Session, project, budgeted, other_user, config
) -> None:
    row = upload(client, project, picture(300, 200, "PNG")).json()
    login = client.post("/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD})
    assert login.status_code == 200
    assert client.get(f"/api/builder/projects/{project.id}/references").status_code == 404
    assert client.get(f"/api/builder/projects/{project.id}/references/{row['id']}/file").status_code == 404
    assert client.delete(f"/api/builder/projects/{project.id}/references/{row['id']}").status_code in (403, 404)


def test_x_removes_a_waiting_picture_and_its_bytes(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    row = upload(client, project, picture(300, 200, "PNG")).json()
    key = f"builder-ref/{project.id}/{row['id']}"
    assert get_storage(config).exists(key)
    assert client.delete(f"/api/builder/projects/{project.id}/references/{row['id']}").status_code == 204
    assert not get_storage(config).exists(key)
    assert client.get(f"/api/builder/projects/{project.id}/references").json() == []


# ------------------------------------------------------------ the run


def test_the_plan_takes_the_pictures_and_every_file_call_is_billed_for_them(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    # The same run without and with pictures: each call costs more with them.
    without = plan(client, project, "카페 메뉴판")
    assert without.status_code == 201, without.text
    plain_plan_tokens = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first().input_tokens

    upload(client, project, picture())
    upload(client, project, picture(800, 1200, "PNG"), "b.png")
    estimate = client.get(f"/api/builder/projects/{project.id}/generate-estimate").json()
    assert estimate["estimated_krw"] > 0

    planned = plan(client, project, "카페 메뉴판")
    assert planned.status_code == 201, planned.text
    generation_id = planned.json()["id"]
    db_session.expire_all()
    rows = db_session.query(BuilderReference).filter_by(project_id=project.id).all()
    assert len(rows) == 2 and all(row.generation_id == generation_id for row in rows)
    # Taken: the request box is empty again, and ✕ can no longer remove them.
    assert client.get(f"/api/builder/projects/{project.id}/references").json() == []
    assert client.delete(f"/api/builder/projects/{project.id}/references/{rows[0].id}").status_code == 409

    picture_tokens = builder_stages.reference_tokens(rows)
    plan_event = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first()
    assert plan_event.input_tokens >= plain_plan_tokens + picture_tokens - 5

    events = run(client, project, generation_id)
    assert events[-1][0] == "done", events[-1]
    db_session.expire_all()
    file_events = db_session.query(UsageEvent).filter(UsageEvent.id > plan_event.id).order_by(UsageEvent.id).all()
    # One per file plus the self-check; each file call carried the pictures.
    written = len(planned.json()["plan"])
    assert len(file_events) >= written
    assert all(event.input_tokens > picture_tokens for event in file_events[:written])
    # The pictures are not files of the app.
    names = set(builder_versions.current_files(db_session, project))
    assert not any(name.endswith((".jpg", ".png", ".webp", ".gif")) for name in names)


def test_the_provider_sees_image_blocks_first_then_the_note_and_the_request() -> None:
    from app.services.claude_provider import REFERENCE_NOTE, with_images

    block = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}}
    assert with_images("요청", None) == "요청"
    content = with_images("요청", [block])
    assert content[0] == block
    assert content[-1]["type"] == "text" and content[-1]["text"].startswith(REFERENCE_NOTE)
    assert content[-1]["text"].endswith("요청")


# ------------------------------------------------------------ clean-up


def test_purge_and_withdrawal_remove_the_bytes(
    client: TestClient, db_session: Session, project, budgeted, dev_user, config
) -> None:
    from app.services import purge

    row = upload(client, project, picture(300, 200, "PNG")).json()
    key = f"builder-ref/{project.id}/{row['id']}"
    assert builder_references.storage_keys(db_session, project.id) == [key]
    # Withdrawal: the member's pictures go.
    assert builder_references.delete_for_user(db_session, get_storage(config), dev_user.id) == 1
    db_session.commit()
    assert not get_storage(config).exists(key)

    # Purge: a deleted project's pictures go with it.
    row = upload(client, project, picture(300, 200, "PNG")).json()
    key = f"builder-ref/{project.id}/{row['id']}"
    from datetime import datetime, timezone

    db_session.expire_all()
    project_row = db_session.get(BuilderProject, project.id)
    project_row.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    facts = purge.purge(db_session, project_row)
    db_session.commit()
    assert key in facts.storage_keys
    purge.remove_files(config, get_storage(config), [facts])
    assert not get_storage(config).exists(key)
    assert db_session.query(BuilderReference).count() == 0


# ------------------------------------------------------------ money (the batch review's focus)


def test_pictures_raise_the_estimate_and_the_charge(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    before = client.get(f"/api/builder/projects/{project.id}/generate-estimate").json()
    upload(client, project, picture())
    after = client.get(f"/api/builder/projects/{project.id}/generate-estimate").json()
    assert after["estimated_krw"] > before["estimated_krw"]
    assert after["worst_case_krw"] >= before["worst_case_krw"]

    planned = plan(client, project, "카페 메뉴판")
    assert planned.status_code == 201
    db_session.expire_all()
    event = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first()
    # The charge is the plan call's tokens, pictures included, priced; the
    # provider's own cost is recorded beside what moved the wallet.
    assert event.charged_krw > 0 and event.provider_cost is not None and event.provider_cost > 0
    assert event.charged_krw == planned.json()["charged_krw"]


def test_a_refused_upload_or_a_failed_plan_charges_nothing(
    client: TestClient, db_session: Session, project, budgeted, config, monkeypatch
) -> None:
    from app.models import ProviderErrorKind
    from app.services.claude_provider import ClaudeError, MockClaudeProvider

    def wallet() -> int:
        db_session.expire_all()
        return sum(event.charged_krw for event in db_session.query(UsageEvent).all())

    start = wallet()
    assert upload(client, project, b"not an image", "x.png").status_code == 400
    assert wallet() == start
    upload(client, project, picture(300, 200, "PNG"))
    assert wallet() == start  # uploading itself is free

    # The provider fails after billing: the member pays 0, the club's cost
    # is recorded, and the picture is still waiting for the next try.
    def failing(*args, **kwargs):
        raise ClaudeError(ProviderErrorKind.TIMEOUT, "test", usage=(5000, 10))

    monkeypatch.setattr(MockClaudeProvider, "plan_project", failing)
    failed = plan(client, project, "카페 메뉴판")
    assert failed.status_code >= 500
    assert wallet() == start
    db_session.expire_all()
    absorbed = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first()
    assert absorbed.charged_krw == 0 and absorbed.provider_cost and absorbed.provider_cost > 0
    assert len(client.get(f"/api/builder/projects/{project.id}/references").json()) == 1


def test_the_wallet_pre_check_counts_the_pictures_in_the_plan_and_every_file_call(
    client: TestClient, db_session: Session, project, budgeted, dev_user, config, monkeypatch
) -> None:
    """What `ensure_affordable` is asked to reserve covers the pictures: the
    plan at least once, each file call once per possible write_file round
    (the real provider resends the first message on every round)."""
    from app.services import builder_choice
    from app.services import usage as usage_service
    from app.services.claude_provider import EDIT_MAX_ROUNDS

    asked: list[int] = []
    real = usage_service.ensure_affordable

    def record(db, *, user, amount_krw, settings):
        asked.append(amount_krw)
        return real(db, user=user, amount_krw=amount_krw, settings=settings)

    monkeypatch.setattr(usage_service, "ensure_affordable", record)
    upload(client, project, picture())
    upload(client, project, picture(800, 1200, "PNG"), "b.png")
    planned = plan(client, project, "카페 메뉴판").json()
    db_session.expire_all()
    rows = db_session.query(BuilderReference).filter_by(generation_id=planned["id"]).all()
    picture_tokens = builder_stages.reference_tokens(rows)
    price = builder_choice.choose(db_session, config, dev_user, project).price
    assert asked[0] >= price.krw(picture_tokens, 0) > 0
    asked.clear()
    events = run(client, project, planned["id"])
    assert events[-1][0] == "done"
    file_calls = asked[: len(planned["plan"])]
    assert len(file_calls) == len(planned["plan"])
    assert all(amount >= price.krw(picture_tokens * EDIT_MAX_ROUNDS, 0) for amount in file_calls)


def test_a_re_plan_keeps_the_pictures(client: TestClient, db_session: Session, project, budgeted, config) -> None:
    upload(client, project, picture(300, 200, "PNG"))
    first = plan(client, project, "카페 메뉴판").json()
    second = plan(client, project, "카페 메뉴판, 더 크게").json()
    assert second["id"] != first["id"]
    db_session.expire_all()
    rows = db_session.query(BuilderReference).filter_by(project_id=project.id).all()
    assert len(rows) == 1 and rows[0].generation_id == second["id"]


def test_the_quota_does_not_count_a_deleted_projects_pictures(
    client: TestClient, db_session: Session, project, budgeted, dev_user, config
) -> None:
    from datetime import datetime, timezone

    upload(client, project, picture(300, 200, "PNG"))
    assert builder_references.member_bytes(db_session, dev_user.id) > 0
    project.deleted_at = datetime.now(timezone.utc)
    db_session.commit()
    assert builder_references.member_bytes(db_session, dev_user.id) == 0
