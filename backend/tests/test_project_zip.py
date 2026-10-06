"""Downloading a Builder project as a ZIP.

What is worth proving here is not that a ZIP comes back. It is that the
archive cannot carry something it should not:

* **no path that leaves the project** — `../../.ssh/id_rsa` as a ZIP
  entry is an attack on whoever unpacks it, and some unpackers follow it;
* **no secrets** — `.env` and keys never go in, so a member who mails
  their project on cannot leak a credential they forgot about;
* **a size limit** — the archive is built in memory, and without a cap
  one project can take the backend down.

The access rule has its own test because it is the opposite of every
other write route: a member who is **not** participating may still
download. Their work is theirs, and CLAUDE.md section 10 says it remains.
"""

import zipfile
from datetime import date
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import BuilderProject, BuilderProjectFile, MembershipStatus, User
from app.services import project_zip
from app.services.quarters import set_membership


@pytest.fixture
def my_project(db_session: Session, dev_user: User) -> BuilderProject:
    project = BuilderProject(owner_user_id=dev_user.id, name="가계부")
    db_session.add(project)
    db_session.flush()
    db_session.add_all(
        [
            BuilderProjectFile(project_id=project.id, path="app/page.tsx", content="export default"),
            BuilderProjectFile(project_id=project.id, path="package.json", content="{}"),
        ]
    )
    db_session.commit()
    db_session.refresh(project)
    return project


def names_in(payload: bytes) -> list[str]:
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        return sorted(archive.namelist())


# --------------------------------------------------------- the packing rules


def test_files_keep_their_folder_structure() -> None:
    payload = project_zip.build("가계부", [("app/page.tsx", "x"), ("package.json", "{}")])

    assert names_in(payload) == [project_zip.GUIDE_NAME, "app/page.tsx", "package.json"]


def test_a_path_that_leaves_the_project_is_dropped() -> None:
    """Every shape of escape, and one bad row must not break the download."""
    escapes = [
        "../outside.txt",
        "../../.ssh/id_rsa",
        "app/../../etc/passwd",
        "/etc/passwd",
        "~/.bashrc",
        "C:/Windows/system.ini",
        "app\\windows\\page.tsx",
        "app//double.txt",
        "app/./here.txt",
        "",
    ]

    payload = project_zip.build("가계부", [*((path, "x") for path in escapes), ("ok.txt", "x")])

    # The good file survived; nothing else did.
    assert names_in(payload) == [project_zip.GUIDE_NAME, "ok.txt"]


def test_secrets_are_never_packed() -> None:
    secrets = [
        ".env",
        ".env.local",
        ".env.staging",
        "config/.env.production",
        "certs/server.pem",
        "certs/server.key",
        "deploy/keystore.jks",
        ".ssh/id_ed25519",
        "secrets.json",
        ".npmrc",
    ]

    payload = project_zip.build("가계부", [*((path, "SECRET") for path in secrets), ("app.py", "x")])

    assert names_in(payload) == [project_zip.GUIDE_NAME, "app.py"]
    # And the bytes are not in the archive under some other name either.
    assert b"SECRET" not in payload


def test_reinstallable_and_history_directories_are_skipped() -> None:
    payload = project_zip.build(
        "가계부",
        [
            ("node_modules/left-pad/index.js", "x"),
            (".git/config", "x"),
            (".next/build-manifest.json", "x"),
            ("__pycache__/app.pyc", "x"),
            ("src/main.py", "x"),
        ],
    )

    assert names_in(payload) == [project_zip.GUIDE_NAME, "src/main.py"]


def test_a_project_over_the_limit_is_refused_in_korean() -> None:
    oversized = [("big.txt", "a" * (project_zip.MAX_TOTAL_BYTES + 1))]

    with pytest.raises(project_zip.ProjectTooLargeError) as refused:
        project_zip.build("가계부", oversized)

    assert "너무 커서" in str(refused.value)


def test_the_guide_is_always_there_and_says_when_there_are_no_files() -> None:
    payload = project_zip.build("가계부", [])

    assert names_in(payload) == [project_zip.GUIDE_NAME]
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        guide = archive.read(project_zip.GUIDE_NAME).decode("utf-8")

    assert "가계부" in guide
    # It must not explain how to run code that is not in the archive.
    assert "아직 파일이 없습니다" in guide
    assert "npm install" not in guide


def test_the_guide_does_not_overwrite_the_project_s_own_readme() -> None:
    payload = project_zip.build("가계부", [("README.md", "회원이 쓴 설명")])

    with zipfile.ZipFile(BytesIO(payload)) as archive:
        assert archive.read("README.md").decode("utf-8") == "회원이 쓴 설명"
        assert project_zip.GUIDE_NAME in archive.namelist()


# ------------------------------------------------------------- the file name


def test_the_download_name_is_readable_and_keeps_korean() -> None:
    assert project_zip.safe_filename("가계부", date(2026, 10, 7), "zip") == "가계부-2026-10-07.zip"


def test_the_download_name_drops_what_a_filesystem_would_read() -> None:
    risky = project_zip.safe_filename('../my "project"/*?|', date(2026, 10, 7), "zip")

    for character in '\\/:*?"<>|':
        assert character not in risky
    assert not risky.startswith(".")


def test_a_name_made_only_of_punctuation_still_produces_a_file() -> None:
    assert project_zip.safe_filename("///", date(2026, 10, 7), "zip") == "ctrlai-2026-10-07.zip"


# ----------------------------------------------------------------- the route


def test_the_owner_downloads_their_project(
    client: TestClient, my_project: BuilderProject
) -> None:
    response = client.get(f"/api/builder/projects/{my_project.id}/download")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert names_in(response.content) == [
        project_zip.GUIDE_NAME,
        "app/page.tsx",
        "package.json",
    ]


def test_the_download_is_offered_as_a_file_with_the_project_s_name(
    client: TestClient, my_project: BuilderProject
) -> None:
    disposition = client.get(
        f"/api/builder/projects/{my_project.id}/download"
    ).headers["content-disposition"]

    assert disposition.startswith("attachment;")
    # The Korean name travels in the UTF-8 form; the ASCII fallback keeps
    # a .zip extension for clients that ignore it.
    assert "filename*=UTF-8''" in disposition
    assert "%EA%B0%80%EA%B3%84%EB%B6%80" in disposition  # 가계부, percent-encoded
    assert f'filename="project-{my_project.id}.zip"' in disposition


def test_an_inactive_owner_may_still_download(
    client: TestClient, db_session: Session, dev_user: User, my_project: BuilderProject, participating
) -> None:
    """The whole point of the feature. Not participating must not lock a
    member out of their own work — only out of making new work."""
    set_membership(db_session, dev_user.id, participating.id, MembershipStatus.INACTIVE)
    db_session.commit()

    # Editing is refused …
    assert client.patch(
        f"/api/builder/projects/{my_project.id}", json={"name": "새 이름"}
    ).status_code == 403
    # … and downloading is not.
    assert client.get(f"/api/builder/projects/{my_project.id}/download").status_code == 200


def test_another_member_cannot_download_my_project(
    other_client: TestClient, my_project: BuilderProject
) -> None:
    assert (
        other_client.get(f"/api/builder/projects/{my_project.id}/download").status_code == 404
    )


def test_a_deleted_project_cannot_be_downloaded(
    client: TestClient, my_project: BuilderProject, participating
) -> None:
    client.delete(f"/api/builder/projects/{my_project.id}")

    assert client.get(f"/api/builder/projects/{my_project.id}/download").status_code == 404


def test_a_secret_stored_on_a_project_never_reaches_the_download(
    client: TestClient, db_session: Session, my_project: BuilderProject
) -> None:
    """End to end, not just in the packer: the route must use the same rules."""
    db_session.add(
        BuilderProjectFile(
            project_id=my_project.id, path=".env", content="ANTHROPIC_API_KEY=sk-live-xxxx"
        )
    )
    db_session.commit()

    response = client.get(f"/api/builder/projects/{my_project.id}/download")

    assert ".env" not in names_in(response.content)
    assert b"sk-live-xxxx" not in response.content
