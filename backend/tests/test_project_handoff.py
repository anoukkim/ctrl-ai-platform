"""project-export-handoff — 프로젝트 내려받기 and 내 Claude로 이어서 만들기.

The ZIP is the project's files of the chosen version plus README /
CLAUDE.md / HANDOFF_PROMPT / HISTORY (and SPEC.md when the project has
one) — and nothing else: no secrets, no other member's data, no owner or
cost figures. The panel's prompt carries the member's extra request; the
admin previews exactly what an example app's ZIP holds.
"""

import zipfile
from io import BytesIO
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import import_example_apps as cli
from app.models import BuilderProject, MembershipStatus, User
from app.services import app_publish, builder_versions, project_handoff, project_zip
from app.services.quarters import set_membership
from app.core.config import Settings
from app.main import app
from tests.conftest import JSON_HEADERS, MEMBER_PASSWORD

GUIDES = ["CLAUDE.md", "HANDOFF_PROMPT.md", "HISTORY.md", "README.md"]


def unzip(payload: bytes) -> dict[str, str]:
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        return {name: archive.read(name).decode("utf-8") for name in archive.namelist()}


def make_project(db: Session, owner: User, name: str = "할 일 메모") -> BuilderProject:
    project = BuilderProject(owner_user_id=owner.id, name=name, description="할 일을 적고 지우는 앱이에요.")
    db.add(project)
    db.flush()
    return project


def write_version(db: Session, project: BuilderProject, note: str, files: dict[str, str]) -> None:
    builder_versions.replace_files(db, project, files)
    builder_versions.snapshot(db, project, note, files)


def member_client(other_user: User) -> TestClient:
    """A second, separate client signed in as the member (`client` and
    `other_client` share one cookie jar)."""
    member = TestClient(app, headers=JSON_HEADERS)
    assert member.post(
        "/api/auth/login", json={"username": other_user.username, "password": MEMBER_PASSWORD}
    ).status_code == 200
    return member


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(app_env="development", apps_dir=str(tmp_path / "apps"), apps_base_url="http://apps.test")


@pytest.fixture
def todo(db_session: Session, dev_user: User) -> BuilderProject:
    """v1 (만들기) → v2 (고치기), with a nested file and localStorage."""
    project = make_project(db_session, dev_user)
    write_version(
        db_session,
        project,
        "만들기: 할 일 앱을 만들어 줘",
        {"index.html": "<title>할 일</title><script src=\"app.js\"></script>", "app.js": "// 할 일 목록 화면.\nlocalStorage"},
    )
    write_version(
        db_session,
        project,
        "고치기: 버튼을 | 초록색으로",
        {
            "index.html": "<title>할 일</title><script src=\"app.js\"></script>",
            "app.js": "// 할 일 목록 화면.\nlocalStorage",
            "css/style.css": "/* 초록 테마 */\nbody{}",
        },
    )
    db_session.commit()
    return project


# ------------------------------------------------------------- the ZIP itself


def test_the_zip_holds_the_files_and_the_four_guides_named_by_slug_and_version(
    client: TestClient, todo: BuilderProject
) -> None:
    response = client.get(f"/api/builder/projects/{todo.id}/download")

    assert response.status_code == 200
    files = unzip(response.content)
    assert sorted(files) == sorted(["app.js", "css/style.css", "index.html", *GUIDES])
    disposition = response.headers["content-disposition"]
    assert f"filename*=UTF-8''{quote('할-일-메모-v2.zip')}" in disposition
    assert f'filename="project-{todo.id}-v2.zip"' in disposition

    readme = files["README.md"]
    assert "# 할 일 메모" in readme and "할 일을 적고 지우는 앱이에요." in readme
    assert "index.html`을 더블클릭" in readme and "python -m http.server 8000" in readme
    assert "`css/style.css` | 초록 테마." in readme  # one line per file, from its own comment
    assert "localStorage" in readme and "## 다음에 해 볼 만한 것" in readme
    assert readme.count("\n1. ") == 1 and "\n3. " in readme
    claude = files["CLAUDE.md"]
    assert "CTRL+AI 밖에서는 이 제한이 더 이상 적용되지 않아요" in claude
    assert "css/\n  style.css" in claude and "200KB" in claude
    assert "첨부한 ZIP은 CTRL+AI에서 만든 내 웹앱이야." in files["HANDOFF_PROMPT.md"]
    assert project_handoff.EXTRA_MARKER in files["HANDOFF_PROMPT.md"]


def test_history_lists_each_version_with_its_request(client: TestClient, todo: BuilderProject) -> None:
    history = unzip(client.get(f"/api/builder/projects/{todo.id}/download").content)["HISTORY.md"]

    assert "| v1 |" in history and "만들기: 할 일 앱을 만들어 줘" in history
    # A pipe in a request cannot break the table.
    assert "고치기: 버튼을 \\| 초록색으로" in history
    assert "이 ZIP은 **v2**이에요." in history


def test_the_published_version_can_be_chosen_instead_of_the_draft(
    client: TestClient, db_session: Session, todo: BuilderProject, settings: Settings
) -> None:
    assert client.get(f"/api/builder/projects/{todo.id}/download?version=published").status_code == 404

    # Publish v2, then change the draft to v3.
    app_publish.publish(db_session, settings, todo, description="할 일 앱", note="")
    write_version(db_session, todo, "고치기: 제목 바꾸기", {"index.html": "<title>새 제목</title>"})
    db_session.commit()

    draft = client.get(f"/api/builder/projects/{todo.id}/download")
    published = client.get(f"/api/builder/projects/{todo.id}/download?version=published")
    assert "-v3.zip" in draft.headers["content-disposition"]
    assert "-v2.zip" in published.headers["content-disposition"]
    assert sorted(unzip(draft.content)) == sorted(["index.html", *GUIDES])
    published_files = unzip(published.content)
    assert "css/style.css" in published_files
    assert "CtrlAIApps에 게시된 버전" in published_files["README.md"]
    # The history stops at the version in the ZIP.
    assert "제목 바꾸기" not in published_files["HISTORY.md"]
    assert "제목 바꾸기" in unzip(draft.content)["HISTORY.md"]

    panel = client.get(f"/api/builder/projects/{todo.id}/handoff?version=published").json()
    assert panel["which"] == "published" and panel["version_number"] == 2
    assert panel["draft_version_number"] == 3 and panel["published_version_number"] == 2
    assert client.get(f"/api/builder/projects/{todo.id}/download?version=v9").status_code == 422


def test_a_project_s_own_guides_win_and_spec_comes_along(
    client: TestClient, db_session: Session, dev_user: User
) -> None:
    project = make_project(db_session, dev_user, "기획 있는 앱")
    write_version(
        db_session,
        project,
        "예시 앱 가져오기",
        {"index.html": "x", "README.md": "회원이 쓴 설명", "SPEC.md": "# 원래 기획"},
    )
    db_session.commit()

    files = unzip(client.get(f"/api/builder/projects/{project.id}/download").content)

    assert files["README.md"] == "회원이 쓴 설명"
    assert files["SPEC.md"] == "# 원래 기획"
    assert "SPEC.md" in files["HANDOFF_PROMPT.md"] and "SPEC.md" in files["CLAUDE.md"]
    panel = client.get(f"/api/builder/projects/{project.id}/handoff").json()
    assert {f["path"]: f["generated"] for f in panel["files"]}["README.md"] is False
    assert {f["path"]: f["generated"] for f in panel["files"]}["CLAUDE.md"] is True
    # The member's panel lists files, never their contents.
    assert all(f["content"] is None for f in panel["files"])


def test_no_secret_no_owner_and_no_other_member_s_data(
    client: TestClient, db_session: Session, todo: BuilderProject, dev_user: User, other_user: User
) -> None:
    from app.models import BuilderProjectFile

    db_session.add(BuilderProjectFile(project_id=todo.id, path=".env", content="ANTHROPIC_API_KEY=sk-live-xxxx"))
    theirs = make_project(db_session, other_user, "남의 비밀 프로젝트")
    write_version(db_session, theirs, "만들기: 비밀 요청", {"index.html": "남의 코드"})
    db_session.commit()

    response = client.get(f"/api/builder/projects/{todo.id}/download")
    payload = response.content
    text = "\n".join(unzip(payload).values())

    assert ".env" not in unzip(payload) and b"sk-live-xxxx" not in payload
    for leaked in (dev_user.username, dev_user.email, dev_user.display_name, "남의", "비밀 요청", "원)", "KRW", "토큰"):
        assert leaked not in text, leaked
    # Only the project's own files and the guides — nothing else.
    assert sorted(unzip(payload)) == sorted(["app.js", "css/style.css", "index.html", *GUIDES])


# ------------------------------------------------------------ the extra request


def test_the_member_s_extra_request_fills_the_prompt(client: TestClient, todo: BuilderProject) -> None:
    extra = "마감일을 넣고 지난 일은 빨갛게"

    panel = client.get(f"/api/builder/projects/{todo.id}/handoff", params={"extra": extra}).json()
    zipped = unzip(client.get(f"/api/builder/projects/{todo.id}/download", params={"extra": extra}).content)

    line = f"{project_handoff.EXTRA_LABEL} {extra}"
    assert line in panel["prompt"] and project_handoff.EXTRA_MARKER not in panel["prompt"]
    assert line in zipped["HANDOFF_PROMPT.md"]
    assert panel["extra_marker"] == project_handoff.EXTRA_MARKER
    assert panel["claude_code_first_line"].startswith("CLAUDE.md를 읽고")
    # Without a request the blank stays for the member to fill in claude.ai.
    blank = client.get(f"/api/builder/projects/{todo.id}/handoff").json()["prompt"]
    assert project_handoff.EXTRA_MARKER in blank


def test_an_overlong_extra_request_is_refused_in_korean(client: TestClient, todo: BuilderProject) -> None:
    response = client.get(
        f"/api/builder/projects/{todo.id}/handoff", params={"extra": "가" * (project_handoff.MAX_EXTRA + 1)}
    )
    assert response.status_code == 400 and "500자" in response.json()["detail"]


def test_a_prompt_without_the_blank_gets_the_request_at_the_end() -> None:
    assert project_handoff.fill_extra("내 프롬프트", "더 빠르게").endswith("내가 추가하고 싶은 것: 더 빠르게\n")
    assert project_handoff.fill_extra("내 프롬프트", "  ") == "내 프롬프트"


# --------------------------------------------------------------- size and access


def test_a_bundle_over_the_size_cap_is_refused(
    client: TestClient, todo: BuilderProject, monkeypatch
) -> None:
    monkeypatch.setattr(project_zip, "MAX_TOTAL_BYTES", 200)

    for route in ("download", "handoff"):
        response = client.get(f"/api/builder/projects/{todo.id}/{route}")
        assert response.status_code == 413 and "너무 커서" in response.json()["detail"]


def test_a_deleted_or_someone_else_s_project_answers_404(
    client: TestClient, other_user: User, todo: BuilderProject, participating
) -> None:
    with member_client(other_user) as member:
        for route in ("download", "handoff"):
            assert member.get(f"/api/builder/projects/{todo.id}/{route}").status_code == 404
    assert client.delete(f"/api/builder/projects/{todo.id}").status_code == 204
    for route in ("download", "handoff"):
        assert client.get(f"/api/builder/projects/{todo.id}/{route}").status_code == 404


def test_an_inactive_member_may_still_take_their_work_out(
    client: TestClient, db_session: Session, dev_user: User, todo: BuilderProject, participating
) -> None:
    set_membership(db_session, dev_user.id, participating.id, MembershipStatus.INACTIVE)
    db_session.commit()

    assert client.get(f"/api/builder/projects/{todo.id}/handoff").status_code == 200
    assert client.get(f"/api/builder/projects/{todo.id}/download").status_code == 200


def test_names_become_safe_slugs() -> None:
    assert project_handoff.slug("영수증 가계부") == "영수증-가계부"
    assert project_handoff.slug('../My "App"*?') == "my-app"
    assert project_handoff.slug("///") == "ctrlai-project"


# ------------------------------------------------------------ the admin preview


def test_the_admin_previews_an_example_app_s_zip_with_contents(
    client: TestClient, db_session: Session, todo: BuilderProject, other_user: User, settings: Settings,
) -> None:
    app_publish.publish(db_session, settings, todo, description="할 일 앱", note="")
    theirs = make_project(db_session, other_user, "회원 앱")
    write_version(db_session, theirs, "만들기: 회원 요청", {"index.html": "x"})
    db_session.commit()

    preview = client.get(f"/api/admin/apps/{todo.id}/handoff")
    assert preview.status_code == 200
    body = preview.json()
    assert body["which"] == "published"
    contents = {f["path"]: f["content"] for f in body["files"]}
    zipped = unzip(client.get(f"/api/builder/projects/{todo.id}/download?version=published").content)
    assert contents == zipped  # exactly what the ZIP holds

    # A member's project is not an example; a member cannot reach the route.
    assert client.get(f"/api/admin/apps/{theirs.id}/handoff?version=draft").status_code == 404
    with member_client(other_user) as member:
        assert member.get(f"/api/admin/apps/{todo.id}/handoff").status_code == 403
    assert client.get("/api/admin/apps").json()[0]["example"] is True


# ------------------------------------------------------------ the showcase apps


@pytest.mark.parametrize("example", cli.EXAMPLES, ids=lambda e: e.folder)
def test_each_showcase_ships_hand_written_guides(example) -> None:
    files = cli.example_files(example)

    for guide in ("README.md", "CLAUDE.md", "HANDOFF_PROMPT.md", "SPEC.md"):
        assert guide in files, guide
    prompt = files["HANDOFF_PROMPT.md"]
    assert prompt.count(project_handoff.EXTRA_MARKER) == 1
    assert "SPEC.md" in prompt and example.name in prompt
    readme = files["README.md"]
    for heading in ("## 열어 보기", "## 파일", "## 다음에 해 볼 만한 것", "## 내 Claude로 이어서 만들기"):
        assert heading in readme, heading
    assert "CTRL+AI 밖에서 만든 변경은 자동으로 돌아오지 않아요" in readme
    assert "CTRL+AI 밖에서는" in files["CLAUDE.md"]
    for path in files:
        if not path.endswith(".md"):
            assert f"`{path}`" in readme, path  # one line per file
