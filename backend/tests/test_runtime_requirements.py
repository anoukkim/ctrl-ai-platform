"""Every third-party import in `app/` is pinned in requirements.txt.

fix-beta-blockers 4: `httpx2` was imported at runtime by the provider key
check but pinned only in requirements-dev.txt, so the production image
worked by luck (the Anthropic SDK pulls it in transitively). This scans
every import in the application — including ones inside functions, which
is how optional providers are imported — and refuses any third-party
module that requirements.txt does not name.
"""

import ast
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"
REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements.txt"

#: import name -> distribution name in requirements.txt, where they differ.
DISTRIBUTION = {
    "argon2": "argon2-cffi",
    "pydantic_settings": "pydantic-settings",
    "email_validator": "pydantic",  # pulled in by pydantic[email]
    "dotenv": "pydantic-settings",  # pulled in by pydantic-settings
    "starlette": "fastapi",  # FastAPI is built on it and pins it
}


def requirement_names() -> set[str]:
    names = set()
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for sep in ("[", ">", "<", "=", "!", "~", ";", " "):
            line = line.split(sep, 1)[0]
        names.add(line.lower())
    return names


def imported_roots() -> set[str]:
    roots: set[str] = set()
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                roots.add(node.module.split(".")[0])
    return roots


def test_runtime_imports_are_pinned_in_requirements() -> None:
    pinned = requirement_names()
    missing = set()
    for root in imported_roots():
        if root in sys.stdlib_module_names or root == "app":
            continue
        distribution = DISTRIBUTION.get(root, root).lower()
        if distribution not in pinned:
            missing.add(root)
    assert not missing, (
        f"app/ imports {sorted(missing)} but requirements.txt does not pin them — "
        "a production image installs requirements.txt only."
    )


def test_httpx2_is_a_runtime_requirement() -> None:
    """The provider key check (`services/providers.py`) imports it directly."""
    assert "httpx2" in requirement_names()
