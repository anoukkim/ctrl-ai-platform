"""Write every live app's folders again, from the server shell
(app-platform P1).

    python -m app.db.rewrite_app_runtime

On the server (docs/deployment.md):

    docker compose -f docker-compose.prod.yml exec api python -m app.db.rewrite_app_runtime

Pages written before P1 carry the old inline storage shim; written again
they load the SDK first (`app_runtime.SDK_TAG`), so `localStorage` and
`ctrlai.storage` are kept by the shell. For each live project: the
published folder from the **published version** (not the working copy —
editing after 게시 must not change what visitors see), and the working
copy's folder from the current files when it had been written before.
Nothing in the database changes; running it twice writes the same files.
"""

from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import BuilderProject
from app.services import app_runtime, builder_versions


def rewrite(db, settings) -> tuple[int, int, list[str]]:
    """(published folders, working copies, problems). Commits nothing."""
    published = drafts = 0
    problems: list[str] = []
    projects = db.scalars(select(BuilderProject).where(BuilderProject.deleted_at.is_(None)))
    for project in projects:
        try:
            if project.published_version is not None and project.app_slug:
                files = {str(path): str(content) for path, content in project.published_version.files}
                app_runtime.write_public(db, settings, project, files)
                published += 1
            if project.draft_slug and project.app_runtime_at is not None:
                files = builder_versions.current_files(db, project)
                if files:
                    app_runtime._write_or_explain(settings, project.draft_slug, app_runtime._checked(settings, files))
                    drafts += 1
        except app_runtime.AppRuntimeError as error:
            problems.append(f"{project.id} {project.name}: {error}")
    return published, drafts, problems


def main(argv: list[str]) -> int:
    if argv:
        print("사용법: python -m app.db.rewrite_app_runtime")
        return 2
    settings = get_settings()
    if not app_runtime.enabled(settings):
        print("앱 주소(APPS_BASE_URL)가 꺼져 있어 쓸 것이 없습니다.")
        return 1
    with SessionLocal() as db:
        published, drafts, problems = rewrite(db, settings)
        db.commit()
    print(f"  게시된 앱 {published}개, 작업 중 사본 {drafts}개를 다시 썼습니다.")
    for problem in problems:
        print(f"  건너뜀: {problem}")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
