"""Admin video model catalogue.

The seeded development user is an admin, so these exercise the happy path
plus the rule that disabling a model also takes it off the member list.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import User, UserRole, VideoModel


def test_admin_sees_hidden_models_and_their_switches(
    client: TestClient, dev_user: User, video_models: list[VideoModel]
) -> None:
    listed = client.get("/api/admin/video-models").json()

    assert [m["model_id"] for m in listed] == ["kling-3.0-pro", "seedance-2.0", "wan-3.0"]
    assert listed[2]["enabled"] is False
    assert listed[2]["member_visible"] is False


def test_admin_can_publish_a_hidden_model(
    client: TestClient, dev_user: User, video_models: list[VideoModel]
) -> None:
    wan = next(m for m in video_models if m.model_id == "wan-3.0")

    body = client.patch(
        f"/api/admin/video-models/{wan.id}", json={"enabled": True, "member_visible": True}
    ).json()

    assert body["enabled"] is True
    assert body["member_visible"] is True
    assert "wan-3.0" in [m["model_id"] for m in client.get("/api/video/models").json()]


def test_disabling_a_model_also_hides_it_from_members(
    client: TestClient, dev_user: User, video_models: list[VideoModel]
) -> None:
    """A disabled model must not stay on offer, whatever the other switch said."""
    kling = next(m for m in video_models if m.model_id == "kling-3.0-pro")

    body = client.patch(f"/api/admin/video-models/{kling.id}", json={"enabled": False}).json()

    assert body["enabled"] is False
    assert body["member_visible"] is False
    assert "kling-3.0-pro" not in [m["model_id"] for m in client.get("/api/video/models").json()]


def test_a_plain_member_cannot_reach_the_catalogue(
    client: TestClient, db_session: Session, dev_user: User, video_models: list[VideoModel]
) -> None:
    """Authorization is checked on the backend, not by hiding a button."""
    dev_user.role = UserRole.MEMBER
    db_session.commit()

    assert client.get("/api/admin/video-models").status_code == 403
    assert (
        client.patch(
            f"/api/admin/video-models/{video_models[0].id}", json={"enabled": False}
        ).status_code
        == 403
    )
