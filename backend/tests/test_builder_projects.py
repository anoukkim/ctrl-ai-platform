"""Project Builder API: ownership is the thing worth proving."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import BuilderProject, BuilderProjectStatus, User


def test_new_project_starts_as_draft_and_belongs_to_me(
    client: TestClient, dev_user: User, participating) -> None:
    response = client.post(
        "/api/builder/projects",
        json={"name": "습관 관리 앱", "description": "매일 체크하는 앱"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "습관 관리 앱"
    assert body["status"] == BuilderProjectStatus.DRAFT.value
    assert body["github_repo"] is None


def test_list_returns_only_my_projects(
    client: TestClient, db_session: Session, dev_user: User, other_user: User
) -> None:
    db_session.add(BuilderProject(owner_user_id=dev_user.id, name="내 프로젝트"))
    db_session.add(BuilderProject(owner_user_id=other_user.id, name="남의 프로젝트"))
    db_session.commit()

    names = [project["name"] for project in client.get("/api/builder/projects").json()]

    assert names == ["내 프로젝트"]


def test_another_members_project_is_not_found(
    client: TestClient, db_session: Session, dev_user: User, other_user: User
) -> None:
    """404 rather than 403, so ids cannot be probed for existence."""
    theirs = BuilderProject(owner_user_id=other_user.id, name="남의 프로젝트")
    db_session.add(theirs)
    db_session.commit()

    assert client.get(f"/api/builder/projects/{theirs.id}").status_code == 404
    assert client.patch(f"/api/builder/projects/{theirs.id}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/builder/projects/{theirs.id}").status_code == 404


def test_another_members_project_survives_a_delete_attempt(
    client: TestClient, db_session: Session, dev_user: User, other_user: User
) -> None:
    theirs = BuilderProject(owner_user_id=other_user.id, name="남의 프로젝트")
    db_session.add(theirs)
    db_session.commit()

    client.delete(f"/api/builder/projects/{theirs.id}")

    assert db_session.get(BuilderProject, theirs.id) is not None


def test_update_changes_only_the_fields_sent(
    client: TestClient, db_session: Session, dev_user: User
) -> None:
    project = BuilderProject(
        owner_user_id=dev_user.id, name="가계부", description="지출 기록"
    )
    db_session.add(project)
    db_session.commit()

    body = client.patch(
        f"/api/builder/projects/{project.id}", json={"status": "ready"}
    ).json()

    assert body["status"] == "ready"
    assert body["name"] == "가계부"
    assert body["description"] == "지출 기록"


def test_owner_cannot_be_set_from_the_request_body(
    client: TestClient, db_session: Session, dev_user: User, other_user: User, participating) -> None:
    """A spoofed owner field is ignored: ownership comes from the session."""
    response = client.post(
        "/api/builder/projects",
        json={"name": "탈취 시도", "owner_user_id": other_user.id},
    )

    assert response.status_code == 201
    created = db_session.get(BuilderProject, response.json()["id"])
    assert created is not None
    assert created.owner_user_id == dev_user.id
