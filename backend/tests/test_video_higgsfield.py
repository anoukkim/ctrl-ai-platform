"""video-higgsfield-only: model-driven settings, edit, extend, charging.

Everything runs on the mock providers. `MockVideoProvider.calls` records
every call the mock received, which is how a test proves a route did —
or did not — reach the video provider.
"""

import math
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import (
    AuditLog,
    MembershipStatus,
    QuarterAllocation,
    UsageEvent,
    User,
    VideoModel,
    VideoProject,
    VideoVersion,
)
from app.services.quarters import set_membership
from app.services.video_provider import MockVideoProvider
from tests.conftest import MEMBER_PASSWORD


@pytest.fixture
def config(tmp_path):
    """Mock providers, storage in a throwaway directory."""
    settings = Settings(storage_dir=str(tmp_path), app_env="development")
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def use_settings(**changes) -> None:
    """Swap the overridden settings for one with `changes` applied."""
    current = app.dependency_overrides[get_settings]()
    changed = current.model_copy(update=changes)
    app.dependency_overrides[get_settings] = lambda: changed


def model_named(models: list[VideoModel], model_id: str) -> VideoModel:
    return next(m for m in models if m.model_id == model_id)


@pytest.fixture
def project(db_session: Session, dev_user: User, video_models) -> VideoProject:
    kling = model_named(video_models, "kling-3.0-pro")
    row = VideoProject(
        owner_user_id=dev_user.id,
        name="밤의 서울",
        prompt="비 오는 밤 서울 골목",
        selected_model_id=kling.id,
    )
    db_session.add(row)
    db_session.commit()
    return row


def generate(client: TestClient, project: VideoProject, **settings):
    return client.post(f"/api/video/projects/{project.id}/versions", json=settings)


def allocation(db_session: Session) -> QuarterAllocation:
    row = db_session.query(QuarterAllocation).one()
    db_session.refresh(row)
    return row


# ------------------------------------------------------------- catalogue


def test_members_receive_each_model_s_full_options(
    client: TestClient, video_models, budgeted
) -> None:
    kling = next(m for m in client.get("/api/video/models").json() if m["model_id"] == "kling-3.0-pro")
    caps = kling["capabilities"]

    assert caps["durations"] == [5, 10, 15]
    assert caps["resolutions"] == ["720p", "1080p"]
    assert caps["price_per_second_krw"] == {"720p": 700, "1080p": 1000}
    assert caps["supports_edit"] is True
    assert caps["supports_extend"] is True
    assert caps["defaults"]["resolution"] == "720p"


def kling_entry(**changes) -> dict:
    entry = {
        "durations": [5, 10],
        "aspect_ratios": ["9:16", "16:9"],
        "resolutions": ["720p", "1080p"],
        "sound": True,
        "supports_edit": True,
        "supports_extend": False,
        "price_per_second_krw": {"720p": 800, "1080p": 1200},
        "defaults": {
            "duration_seconds": 10,
            "aspect_ratio": "16:9",
            "resolution": "1080p",
            "sound": False,
        },
    }
    entry.update(changes)
    return entry


def test_an_admin_saves_a_model_s_options_and_prices(
    client: TestClient, db_session: Session, video_models
) -> None:
    kling = model_named(video_models, "kling-3.0-pro")

    response = client.patch(
        f"/api/admin/video-models/{kling.id}", json={"capabilities": kling_entry()}
    )

    assert response.status_code == 200, response.text
    caps = response.json()["capabilities"]
    assert caps["price_per_second_krw"] == {"720p": 800, "1080p": 1200}
    # Saved by an admin, so no longer a placeholder.
    assert caps["prices_are_examples"] is False

    # A price change moves money, so it is on the audit log with both sides.
    row = db_session.query(AuditLog).one()
    assert row.action == "video_model.updated"
    assert row.detail["before"]["price_per_second_krw"] == {"720p": 700, "1080p": 1000}
    assert row.detail["after"]["price_per_second_krw"] == {"720p": 800, "1080p": 1200}


@pytest.mark.parametrize(
    ("changes", "fragment"),
    [
        ({"durations": []}, "길이"),
        ({"durations": [5, 90]}, "60초"),
        ({"aspect_ratios": ["4:5"]}, "4:5"),
        ({"resolutions": ["HD"]}, "720p처럼"),
        ({"price_per_second_krw": {"720p": 800}}, "1080p"),
        ({"price_per_second_krw": {"720p": 800, "1080p": 0}}, "초당 가격"),
        (
            {"defaults": {"duration_seconds": 15, "aspect_ratio": "16:9", "resolution": "720p", "sound": False}},
            "기본 길이",
        ),
        (
            {"defaults": {"duration_seconds": 5, "aspect_ratio": "1:1", "resolution": "720p", "sound": False}},
            "기본 비율",
        ),
        (
            {"sound": False, "defaults": {"duration_seconds": 5, "aspect_ratio": "9:16", "resolution": "720p", "sound": True}},
            "소리",
        ),
        ({"durations": "다섯"}, "형식"),
    ],
)
def test_an_invalid_catalogue_entry_is_refused_in_korean(
    client: TestClient, db_session: Session, video_models, changes: dict, fragment: str
) -> None:
    kling = model_named(video_models, "kling-3.0-pro")
    before = dict(kling.capabilities)

    response = client.patch(
        f"/api/admin/video-models/{kling.id}", json={"capabilities": kling_entry(**changes)}
    )

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert fragment in response.json()["detail"]
    db_session.refresh(kling)
    assert kling.capabilities == before


def test_a_member_cannot_edit_the_catalogue(
    other_client: TestClient, video_models
) -> None:
    kling = model_named(video_models, "kling-3.0-pro")
    response = other_client.patch(
        f"/api/admin/video-models/{kling.id}", json={"capabilities": kling_entry()}
    )
    assert response.status_code == 403


# -------------------------------------------------------------- generate


def test_generation_charges_duration_times_the_resolution_s_price(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    """The estimate on the screen is the same formula: 10s x 1,000원 at 1080p."""
    response = generate(client, project, duration_seconds=10, aspect_ratio="16:9", resolution="1080p")

    assert response.status_code == 201, response.text
    version = response.json()
    assert version["resolution"] == "1080p"
    assert allocation(db_session).video_consumed_krw == 10_000
    assert allocation(db_session).build_consumed_krw == 0

    event = db_session.query(UsageEvent).one()
    assert event.provider == "higgsfield"
    assert event.feature == "video_generate"
    assert event.model_id == "kling-3.0-pro"
    assert (event.provider_units, event.provider_unit) == (10, "seconds")
    assert event.charged_krw == 10_000
    assert event.funding_source.value == "community_video"
    assert event.video_version_id == version["id"]
    assert event.video_project_id == project.id


@pytest.mark.parametrize(
    ("settings", "fragment"),
    [
        ({"duration_seconds": 7}, "7초"),
        ({"aspect_ratio": "4:3"}, "4:3"),
        ({"resolution": "4k"}, "4k"),
        ({"resolution": "480p"}, "480p"),  # Seedance's, not Kling's
    ],
)
def test_settings_outside_the_catalogue_are_refused_and_not_charged(
    client: TestClient, db_session: Session, project, budgeted, config, settings, fragment
) -> None:
    calls = len(MockVideoProvider.calls)

    response = generate(client, project, **settings)

    assert response.status_code == 400
    assert fragment in response.json()["detail"]
    assert len(MockVideoProvider.calls) == calls
    assert db_session.query(VideoVersion).count() == 0
    assert db_session.query(UsageEvent).count() == 0


def test_without_enough_budget_nothing_is_called_or_charged(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    budgeted.video_budget_krw = 3_000  # a 5s 720p Kling version costs 3,500원
    db_session.commit()
    calls = len(MockVideoProvider.calls)

    response = generate(client, project)

    assert response.status_code == 402
    assert "지원금" in response.json()["detail"]
    assert len(MockVideoProvider.calls) == calls
    assert db_session.query(VideoVersion).count() == 0
    assert allocation(db_session).video_consumed_krw == 0


def test_a_participant_with_no_allocation_is_refused(
    client: TestClient, db_session: Session, project, participating, config
) -> None:
    response = generate(client, project)

    assert response.status_code == 402
    assert db_session.query(VideoVersion).count() == 0


def test_the_real_higgsfield_is_never_called_and_never_charged(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    """Selecting `higgsfield` reaches an adapter that refuses — nothing in
    this branch contacts Higgsfield — and the refusal costs nothing."""
    use_settings(video_provider="higgsfield")

    response = generate(client, project)

    assert response.status_code == 503
    assert "Higgsfield" in response.json()["detail"]
    assert db_session.query(VideoVersion).count() == 0
    assert allocation(db_session).video_consumed_krw == 0


# ---------------------------------------------------------- edit / extend


@pytest.fixture
def source(client: TestClient, project, budgeted, config) -> dict:
    made = generate(client, project, duration_seconds=10, aspect_ratio="9:16", resolution="720p")
    assert made.status_code == 201, made.text
    return made.json()


def test_editing_makes_a_linked_version_with_the_source_s_framing(
    client: TestClient, db_session: Session, project, source
) -> None:
    response = client.post(
        f"/api/video/projects/{project.id}/versions/{source['id']}/edit",
        json={"instruction": "비를 눈으로 바꿔줘"},
    )

    assert response.status_code == 201, response.text
    edited = response.json()
    assert edited["kind"] == "edit"
    assert edited["source_version_id"] == source["id"]
    assert edited["instruction"] == "비를 눈으로 바꿔줘"
    assert edited["label"] == "v2"
    for field in ("duration_seconds", "aspect_ratio", "resolution", "model_id"):
        assert edited[field] == source[field]

    # 10s at 720p twice: the generation, then the edit.
    assert allocation(db_session).video_consumed_krw == 7_000 + 7_000
    event = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first()
    assert event.feature == "video_edit"
    assert event.video_version_id == edited["id"]


def test_extending_adds_the_chosen_length_and_charges_only_that(
    client: TestClient, db_session: Session, project, source
) -> None:
    response = client.post(
        f"/api/video/projects/{project.id}/versions/{source['id']}/extend",
        json={"duration_seconds": 5},
    )

    assert response.status_code == 201, response.text
    extended = response.json()
    assert extended["kind"] == "extend"
    assert extended["source_version_id"] == source["id"]
    assert extended["duration_seconds"] == 15
    assert extended["aspect_ratio"] == "9:16"

    assert allocation(db_session).video_consumed_krw == 7_000 + 5 * 700
    event = db_session.query(UsageEvent).order_by(UsageEvent.id.desc()).first()
    assert event.feature == "video_extend"
    assert event.provider_units == 5


def test_an_extension_length_the_model_does_not_offer_is_refused(
    client: TestClient, db_session: Session, project, source
) -> None:
    response = client.post(
        f"/api/video/projects/{project.id}/versions/{source['id']}/extend",
        json={"duration_seconds": 7},
    )
    assert response.status_code == 400
    assert db_session.query(VideoVersion).count() == 1


def test_a_model_without_edit_or_extend_refuses_them(
    client: TestClient, db_session: Session, project, source, video_models
) -> None:
    kling = model_named(video_models, "kling-3.0-pro")
    kling.capabilities = {**kling.capabilities, "supports_edit": False, "supports_extend": False}
    db_session.commit()
    calls = len(MockVideoProvider.calls)

    edit = client.post(
        f"/api/video/projects/{project.id}/versions/{source['id']}/edit",
        json={"instruction": "더 밝게"},
    )
    extend = client.post(
        f"/api/video/projects/{project.id}/versions/{source['id']}/extend",
        json={"duration_seconds": 5},
    )

    assert edit.status_code == 400 and "수정" in edit.json()["detail"]
    assert extend.status_code == 400 and "이어서" in extend.json()["detail"]
    assert len(MockVideoProvider.calls) == calls


def test_seedance_extends_but_does_not_edit(
    client: TestClient, db_session: Session, project, budgeted, config, video_models
) -> None:
    seedance = model_named(video_models, "seedance-2.0")
    project.selected_model_id = seedance.id
    db_session.commit()
    made = generate(client, project).json()

    edit = client.post(
        f"/api/video/projects/{project.id}/versions/{made['id']}/edit",
        json={"instruction": "더 밝게"},
    )
    extend = client.post(
        f"/api/video/projects/{project.id}/versions/{made['id']}/extend",
        json={"duration_seconds": 5},
    )

    assert edit.status_code == 400
    assert extend.status_code == 201


def test_a_version_with_no_recorded_settings_cannot_be_a_source(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    """Made before the settings were recorded: there is no honest price."""
    old = VideoVersion(
        project_id=project.id,
        provider="higgsfield",
        model_id="kling-3.0-pro",
        asset_storage_key="video/1/1.gif",
    )
    db_session.add(old)
    db_session.commit()

    response = client.post(
        f"/api/video/projects/{project.id}/versions/{old.id}/edit",
        json={"instruction": "더 밝게"},
    )

    assert response.status_code == 400
    assert "기록되지" in response.json()["detail"]


def test_an_inactive_member_cannot_edit_or_extend(
    client: TestClient, db_session: Session, dev_user: User, project, source
) -> None:
    set_membership(db_session, dev_user.id, project_quarter(db_session), MembershipStatus.INACTIVE)
    db_session.commit()

    for path, body in [
        (f"versions/{source['id']}/edit", {"instruction": "더 밝게"}),
        (f"versions/{source['id']}/extend", {"duration_seconds": 5}),
        ("prompt-help", {"prompt": "밤", "request": "더 밝게"}),
    ]:
        response = client.post(f"/api/video/projects/{project.id}/{path}", json=body)
        assert response.status_code == 403, path


def project_quarter(db_session: Session) -> int:
    return db_session.query(QuarterAllocation).one().quarter_id


def test_another_member_cannot_edit_my_version(
    client: TestClient, other_user: User, project, source, other_participating
) -> None:
    # `client` and `other_client` are one TestClient with one cookie jar,
    # so sign in as the other member here, after `source` was made as dev.
    signed_in = client.post(
        "/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}
    )
    assert signed_in.status_code == 200

    response = client.post(
        f"/api/video/projects/{project.id}/versions/{source['id']}/edit",
        json={"instruction": "내 것으로"},
    )
    assert response.status_code == 404


# ---------------------------------------------------------- prompt helper


def test_the_prompt_helper_rewrites_text_and_charges_build(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    calls = len(MockVideoProvider.calls)

    response = client.post(
        f"/api/video/projects/{project.id}/prompt-help",
        json={"prompt": "비 오는 밤 서울 골목", "request": "조금 더 어둡게"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["revised_prompt"].startswith("비 오는 밤 서울 골목")

    event = db_session.query(UsageEvent).one()
    assert (event.provider, event.feature, event.model_id) == ("claude", "video_prompt", "mock")
    assert event.category.value == "build"
    assert event.provider_unit == "tokens"
    assert event.provider_units == event.input_tokens + event.output_tokens > 0

    # Priced by the token since Phase 2 — the mock at Sonnet 5.5's list
    # price ($2 in / $10 out per million) and 1,400원 to the dollar, rounded up.
    usd = (Decimal(event.input_tokens) * 2 + Decimal(event.output_tokens) * 10) / 1_000_000
    expected = math.ceil(usd * 1400)
    assert event.provider_cost == usd.quantize(Decimal("0.000001"))
    assert event.exchange_rate_krw == 1400
    assert body["charged_krw"] == event.charged_krw == expected

    # Claude, not Higgsfield: no provider call, no version, no Video money.
    assert len(MockVideoProvider.calls) == calls
    assert db_session.query(VideoVersion).count() == 0
    assert allocation(db_session).video_consumed_krw == 0
    assert allocation(db_session).build_consumed_krw == expected

    # The project's prompt is the member's to change, not the helper's.
    db_session.refresh(project)
    assert project.prompt == "비 오는 밤 서울 골목"


def test_the_prompt_helper_is_refused_without_build_budget(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    budgeted.build_budget_krw = 0
    db_session.commit()

    response = client.post(
        f"/api/video/projects/{project.id}/prompt-help",
        json={"prompt": "밤", "request": "더 밝게"},
    )

    assert response.status_code == 402
    assert db_session.query(UsageEvent).count() == 0


def test_the_prompt_helper_with_no_real_claude_is_not_charged(
    client: TestClient, db_session: Session, project, budgeted, config
) -> None:
    use_settings(claude_provider="anthropic")

    response = client.post(
        f"/api/video/projects/{project.id}/prompt-help",
        json={"prompt": "밤", "request": "더 밝게"},
    )

    assert response.status_code == 503
    assert allocation(db_session).build_consumed_krw == 0


def test_usage_names_what_each_video_charge_was_for(
    client: TestClient, project, source
) -> None:
    client.post(
        f"/api/video/projects/{project.id}/prompt-help",
        json={"prompt": "밤", "request": "더 밝게"},
    )

    labels = [event["label"] for event in client.get("/api/usage/me").json()["events"]]

    assert labels == ["프롬프트 도움 — 밤의 서울", "영상 생성 — 밤의 서울"]
