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
    client: TestClient, dev_user: User, video_models: list[VideoModel]
) -> None:
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
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel]
) -> None:
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
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel]
) -> None:
    project = VideoProject(owner_user_id=dev_user.id, name="버전 테스트", prompt="첫 프롬프트")
    db_session.add(project)
    db_session.commit()

    client.post(f"/api/video/projects/{project.id}/versions")
    second = client.post(f"/api/video/projects/{project.id}/versions").json()

    assert second["label"] == "v2"


def test_final_version_must_belong_to_the_project(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel]
) -> None:
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
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel]
) -> None:
    project = VideoProject(owner_user_id=dev_user.id, name="A", prompt="a")
    db_session.add(project)
    db_session.commit()

    version = client.post(f"/api/video/projects/{project.id}/versions").json()
    body = client.patch(
        f"/api/video/projects/{project.id}", json={"final_version_id": version["id"]}
    ).json()

    assert body["final_version_id"] == version["id"]
