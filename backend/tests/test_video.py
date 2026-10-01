"""Video Generator API: the model allowlist and project ownership."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import User, VideoModel, VideoProject


def test_members_only_see_enabled_and_visible_models(
    client: TestClient, video_models: list[VideoModel]
) -> None:
    """The seed has three models; the third is disabled and hidden."""
    listed = client.get("/api/video/models").json()

    assert [m["model_id"] for m in listed] == ["kling-3.0-pro", "seedance-2.0"]
    # The switches themselves are not part of the member-facing shape.
    assert "enabled" not in listed[0]
    assert "member_visible" not in listed[0]


def test_hiding_a_model_removes_it_from_the_member_list(
    client: TestClient, db_session: Session, video_models: list[VideoModel]
) -> None:
    kling = next(m for m in video_models if m.model_id == "kling-3.0-pro")
    kling.member_visible = False
    db_session.commit()

    listed = client.get("/api/video/models").json()

    assert [m["model_id"] for m in listed] == ["seedance-2.0"]


def test_cannot_select_a_model_that_is_not_allowed(
    client: TestClient, dev_user: User, video_models: list[VideoModel], participating) -> None:
    hidden = next(m for m in video_models if m.model_id == "wan-3.0")

    response = client.post(
        "/api/video/projects",
        json={"name": "숨은 모델", "prompt": "테스트", "selected_model_id": hidden.id},
    )

    assert response.status_code == 400


def test_project_lists_are_scoped_to_the_owner(
    client: TestClient, db_session: Session, dev_user: User, other_user: User
) -> None:
    db_session.add(VideoProject(owner_user_id=dev_user.id, name="비 오는 서울"))
    db_session.add(VideoProject(owner_user_id=other_user.id, name="남의 영상"))
    db_session.commit()

    names = [p["name"] for p in client.get("/api/video/projects").json()]

    assert names == ["비 오는 서울"]


def test_another_members_video_project_is_not_found(
    client: TestClient, db_session: Session, dev_user: User, other_user: User
) -> None:
    theirs = VideoProject(owner_user_id=other_user.id, name="남의 영상")
    db_session.add(theirs)
    db_session.commit()

    assert client.get(f"/api/video/projects/{theirs.id}").status_code == 404


def test_generating_a_version_snapshots_the_prompt(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating) -> None:
    project = VideoProject(
        owner_user_id=dev_user.id, name="비 오는 서울", prompt="비 오는 밤 서울 골목"
    )
    db_session.add(project)
    db_session.commit()

    version = client.post(f"/api/video/projects/{project.id}/versions").json()

    assert version["prompt_snapshot"] == "비 오는 밤 서울 골목"
    assert version["label"] == "v1"
    assert version["provider"] == "higgsfield"
    # No model chosen means Auto, which falls back to the first allowed one.
    assert version["model_id"] == "kling-3.0-pro"
    # Nothing was generated, so there is no asset and no provider job.
    assert version["asset_url"] is None
    assert version["provider_job_id"] is None


def test_versions_are_numbered_within_the_project(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating) -> None:
    project = VideoProject(owner_user_id=dev_user.id, name="버전 테스트", prompt="첫 프롬프트")
    db_session.add(project)
    db_session.commit()

    client.post(f"/api/video/projects/{project.id}/versions")
    second = client.post(f"/api/video/projects/{project.id}/versions").json()

    assert second["label"] == "v2"


def test_final_version_must_belong_to_the_project(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating) -> None:
    project = VideoProject(owner_user_id=dev_user.id, name="A", prompt="a")
    other = VideoProject(owner_user_id=dev_user.id, name="B", prompt="b")
    db_session.add_all([project, other])
    db_session.commit()

    stray = client.post(f"/api/video/projects/{other.id}/versions").json()

    response = client.patch(
        f"/api/video/projects/{project.id}", json={"final_version_id": stray["id"]}
    )

    assert response.status_code == 400


def test_selecting_a_final_version_from_this_project_works(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating) -> None:
    project = VideoProject(owner_user_id=dev_user.id, name="A", prompt="a")
    db_session.add(project)
    db_session.commit()

    version = client.post(f"/api/video/projects/{project.id}/versions").json()
    body = client.patch(
        f"/api/video/projects/{project.id}", json={"final_version_id": version["id"]}
    ).json()

    assert body["final_version_id"] == version["id"]


# ---------------------------------------------------------------------------
# What a version was made with
#
# A version used to keep only its prompt and model, so the workspace had
# nothing to show a length from and played every version as 15 seconds —
# including ones made at 10. These settings are now recorded per version for
# the same reason the prompt is: the member keeps changing the controls, and
# a version has to keep showing what actually produced it.
# ---------------------------------------------------------------------------


def test_a_version_records_the_settings_it_was_made_with(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating
) -> None:
    project = VideoProject(owner_user_id=dev_user.id, name="설정 기록", prompt="테스트")
    db_session.add(project)
    db_session.commit()

    version = client.post(
        f"/api/video/projects/{project.id}/versions",
        json={"duration_seconds": 10, "aspect_ratio": "16:9", "sound": True},
    ).json()

    assert version["duration_seconds"] == 10
    assert version["aspect_ratio"] == "16:9"
    assert version["sound"] is True


def test_settings_stay_with_the_version_after_the_project_changes(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating
) -> None:
    """The point of recording them: v1 keeps its own figures."""
    project = VideoProject(owner_user_id=dev_user.id, name="설정 유지", prompt="첫 번째")
    db_session.add(project)
    db_session.commit()

    client.post(
        f"/api/video/projects/{project.id}/versions",
        json={"duration_seconds": 5, "aspect_ratio": "9:16", "sound": False},
    )
    client.post(
        f"/api/video/projects/{project.id}/versions",
        json={"duration_seconds": 15, "aspect_ratio": "16:9", "sound": True},
    )

    versions = client.get(f"/api/video/projects/{project.id}").json()["versions"]

    assert [v["duration_seconds"] for v in versions] == [5, 15]
    assert [v["aspect_ratio"] for v in versions] == ["9:16", "16:9"]


def test_auto_is_recorded_so_the_screen_can_say_what_it_chose(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating
) -> None:
    """No model chosen means Auto. The version keeps both facts: that it was
    Auto, and which model Auto resolved to."""
    project = VideoProject(owner_user_id=dev_user.id, name="Auto", prompt="테스트")
    db_session.add(project)
    db_session.commit()

    version = client.post(f"/api/video/projects/{project.id}/versions").json()

    assert version["auto_selected"] is True
    assert version["model_id"] == "kling-3.0-pro"


def test_choosing_a_model_is_not_recorded_as_auto(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating
) -> None:
    seedance = next(m for m in video_models if m.model_id == "seedance-2.0")
    project = VideoProject(
        owner_user_id=dev_user.id, name="직접 고름", prompt="테스트", selected_model_id=seedance.id
    )
    db_session.add(project)
    db_session.commit()

    version = client.post(f"/api/video/projects/{project.id}/versions").json()

    assert version["auto_selected"] is False
    assert version["model_id"] == "seedance-2.0"


def test_a_length_the_model_cannot_do_is_refused(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating
) -> None:
    """Seedance does 5 and 10 seconds only. The browser greys 15 out; the
    backend has to refuse it too, because a browser can send anything."""
    seedance = next(m for m in video_models if m.model_id == "seedance-2.0")
    project = VideoProject(
        owner_user_id=dev_user.id, name="길이 검사", prompt="테스트", selected_model_id=seedance.id
    )
    db_session.add(project)
    db_session.commit()

    response = client.post(
        f"/api/video/projects/{project.id}/versions", json={"duration_seconds": 15}
    )

    assert response.status_code == 400
    assert "15초" in response.json()["detail"]


def test_an_aspect_ratio_the_model_cannot_do_is_refused(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating
) -> None:
    """Seedance is 9:16 only."""
    seedance = next(m for m in video_models if m.model_id == "seedance-2.0")
    project = VideoProject(
        owner_user_id=dev_user.id, name="비율 검사", prompt="테스트", selected_model_id=seedance.id
    )
    db_session.add(project)
    db_session.commit()

    response = client.post(
        f"/api/video/projects/{project.id}/versions", json={"aspect_ratio": "16:9"}
    )

    assert response.status_code == 400
    assert "16:9" in response.json()["detail"]


def test_a_silent_model_records_a_silent_version(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating
) -> None:
    """Seedance has no sound. Asking for it is corrected quietly rather than
    refused: the screen already says the model is silent, and refusing would
    block a generation over something the member cannot change."""
    seedance = next(m for m in video_models if m.model_id == "seedance-2.0")
    project = VideoProject(
        owner_user_id=dev_user.id, name="소리 없음", prompt="테스트", selected_model_id=seedance.id
    )
    db_session.add(project)
    db_session.commit()

    version = client.post(
        f"/api/video/projects/{project.id}/versions", json={"sound": True}
    ).json()

    assert version["sound"] is False


def test_a_version_with_no_settings_sent_records_none(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel], participating
) -> None:
    """An empty body still works, and the figures stay unknown rather than
    being invented. The workspace shows "unknown", not a wrong number."""
    project = VideoProject(owner_user_id=dev_user.id, name="빈 본문", prompt="테스트")
    db_session.add(project)
    db_session.commit()

    version = client.post(f"/api/video/projects/{project.id}/versions").json()

    assert version["duration_seconds"] is None
    assert version["aspect_ratio"] is None
