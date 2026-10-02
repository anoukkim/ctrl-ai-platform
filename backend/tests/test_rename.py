"""Renaming a project or a video: one rule, both products, Korean refusals.

The rule, from the `project-video-management` spec: trimmed, 1–60
characters, duplicates allowed, owner only and only while participating.

The three places a rename can start from in the UI — the workspace title,
the ▾ menu, the library's item menu — all send the same PATCH, so there is
one thing to test rather than three.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import BuilderProject, MembershipStatus, User, VideoProject
from app.services.quarters import set_membership
from app.services.work import NAME_MAX_LENGTH, InvalidNameError, clean_name


@pytest.fixture
def my_project(db_session: Session, dev_user: User) -> BuilderProject:
    project = BuilderProject(owner_user_id=dev_user.id, name="가계부")
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


@pytest.fixture
def my_video(db_session: Session, dev_user: User) -> VideoProject:
    project = VideoProject(owner_user_id=dev_user.id, name="밤의 서울")
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


# ------------------------------------------------------------- the rule itself


def test_clean_name_trims() -> None:
    assert clean_name("  가계부  ") == "가계부"


def test_clean_name_refuses_blank_in_korean() -> None:
    for blank in ("", "   ", "\t\n"):
        with pytest.raises(InvalidNameError) as refused:
            clean_name(blank)
        assert "이름을 입력해 주세요" in str(refused.value)


def test_clean_name_counts_after_trimming() -> None:
    """A padded name at the limit is the limit, not over it."""
    at_limit = "가" * NAME_MAX_LENGTH
    assert clean_name(f"  {at_limit}  ") == at_limit

    with pytest.raises(InvalidNameError) as refused:
        clean_name("가" * (NAME_MAX_LENGTH + 1))
    assert str(NAME_MAX_LENGTH) in str(refused.value)


# --------------------------------------------------------------- the owner


@pytest.mark.parametrize(
    ("path", "fixture_name"),
    [("/api/builder/projects", "my_project"), ("/api/video/projects", "my_video")],
)
def test_the_owner_renames(
    client: TestClient, request: pytest.FixtureRequest, participating, path: str, fixture_name: str
) -> None:
    item = request.getfixturevalue(fixture_name)

    response = client.patch(f"{path}/{item.id}", json={"name": "  새 이름  "})

    assert response.status_code == 200
    assert response.json()["name"] == "새 이름", "저장할 때 앞뒤 공백을 지워야 합니다"


@pytest.mark.parametrize(
    ("path", "fixture_name"),
    [("/api/builder/projects", "my_project"), ("/api/video/projects", "my_video")],
)
def test_an_empty_name_is_refused_with_a_korean_message(
    client: TestClient, request: pytest.FixtureRequest, participating, path: str, fixture_name: str
) -> None:
    """400 with a string detail, not 422 with a list — the screen shows this."""
    item = request.getfixturevalue(fixture_name)

    response = client.patch(f"{path}/{item.id}", json={"name": "   "})

    assert response.status_code == 400
    assert response.json()["detail"] == "이름을 입력해 주세요."


@pytest.mark.parametrize(
    ("path", "fixture_name"),
    [("/api/builder/projects", "my_project"), ("/api/video/projects", "my_video")],
)
def test_a_too_long_name_is_refused(
    client: TestClient, request: pytest.FixtureRequest, participating, path: str, fixture_name: str
) -> None:
    item = request.getfixturevalue(fixture_name)

    response = client.patch(f"{path}/{item.id}", json={"name": "가" * 61})

    assert response.status_code == 400
    assert "60자" in response.json()["detail"]


def test_a_refused_rename_leaves_the_old_name(
    client: TestClient, db_session: Session, my_project: BuilderProject, participating
) -> None:
    client.patch(f"/api/builder/projects/{my_project.id}", json={"name": ""})

    db_session.expire_all()
    assert db_session.get(BuilderProject, my_project.id).name == "가계부"


def test_duplicate_names_are_allowed(
    client: TestClient, db_session: Session, dev_user: User, my_project: BuilderProject, participating
) -> None:
    """Nothing is addressed by name, so uniqueness would only get in the way."""
    second = BuilderProject(owner_user_id=dev_user.id, name="다른 것")
    db_session.add(second)
    db_session.commit()

    response = client.patch(f"/api/builder/projects/{second.id}", json={"name": "가계부"})

    assert response.status_code == 200
    names = sorted(p["name"] for p in client.get("/api/builder/projects").json())
    assert names == ["가계부", "가계부"]


def test_creating_also_trims_and_refuses_blank(client: TestClient, participating) -> None:
    """The same rule on the way in, so a name can never be saved untrimmed."""
    created = client.post("/api/builder/projects", json={"name": "  습관 관리  "})
    assert created.status_code == 201
    assert created.json()["name"] == "습관 관리"

    refused = client.post("/api/builder/projects", json={"name": " "})
    assert refused.status_code == 400
    assert refused.json()["detail"] == "이름을 입력해 주세요."


# ----------------------------------------------------------------- refusals


def test_another_member_cannot_rename_my_project(
    other_client: TestClient, db_session: Session, my_project: BuilderProject, other_participating
) -> None:
    """404, not 403: ownership must not be probeable."""
    assert (
        other_client.patch(
            f"/api/builder/projects/{my_project.id}", json={"name": "내 것으로"}
        ).status_code
        == 404
    )

    db_session.expire_all()
    assert db_session.get(BuilderProject, my_project.id).name == "가계부"


def test_an_inactive_owner_cannot_rename(
    client: TestClient, db_session: Session, dev_user: User, my_project: BuilderProject, participating
) -> None:
    set_membership(db_session, dev_user.id, participating.id, MembershipStatus.INACTIVE)
    db_session.commit()

    response = client.patch(f"/api/builder/projects/{my_project.id}", json={"name": "고친 이름"})

    assert response.status_code == 403
    db_session.expire_all()
    assert db_session.get(BuilderProject, my_project.id).name == "가계부"


def test_a_deleted_project_cannot_be_renamed(
    client: TestClient, my_project: BuilderProject, participating
) -> None:
    client.delete(f"/api/builder/projects/{my_project.id}")

    assert (
        client.patch(f"/api/builder/projects/{my_project.id}", json={"name": "유령"}).status_code
        == 404
    )
