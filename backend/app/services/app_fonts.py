"""The Korean font catalogue for member apps (feat-app-fonts).

A member app runs fenced in: no network, and fonts only from its own origin
(`font-src 'self' data:`, `app_shell.app_files_csp`). So an app that asks for
"Jua" has nowhere to get it from — unless CTRL+AI itself serves the file.
That is this module: OFL fonts, cut down to what an app screen needs
(`backend/tools/build_fonts.py`), kept in `static/fonts/` and served by the
api under `/_ctrlai/` (the path Caddy and `dev_apps_server` already send to
the api on the apps origin). The CSP does not change.

* `/_ctrlai/fonts.css` — one `@font-face` per file. The browser downloads
  only the files an app actually uses.
* `/_ctrlai/fonts/<file>.woff2` — the files. Public, with CORS `*`: a
  font is always fetched with CORS, and the app's origin is opaque.
* An HTML page gets `FONTS_TAG` (beside `SDK_TAG`) when its app names a
  catalogue family; an app that does not pays nothing.

Adding a font changes `tools/build_fonts.py` and the files; nothing here.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

FONT_DIR = Path(__file__).resolve().parent.parent / "static" / "fonts"

#: Loaded by the app's page; same origin as the app, so `style-src 'self'`.
FONTS_TAG = '<link rel="stylesheet" href="/_ctrlai/fonts.css">'

#: `<slug>.woff2`, lower-case letters, digits and hyphens — also what keeps
#: a request from leaving the folder.
FILE_PATTERN = re.compile(r"^[a-z0-9-]+\.woff2$")

#: Only these file kinds are searched for a family name.
_TEXT_SUFFIXES = (".html", ".css", ".js")


@lru_cache(maxsize=1)
def catalogue() -> list[dict]:
    """The manifest: `{family, mood, license, copyright, faces: [{file, weight}]}`."""
    return json.loads((FONT_DIR / "manifest.json").read_text(encoding="utf-8"))


def families() -> list[str]:
    return [entry["family"] for entry in catalogue()]


def by_mood() -> dict[str, list[str]]:
    """Family names grouped by 분위기, in catalogue order."""
    groups: dict[str, list[str]] = {}
    for entry in catalogue():
        groups.setdefault(entry["mood"], []).append(entry["family"])
    return groups


def prompt_list() -> str:
    """The catalogue as one block for the Builder's instructions."""
    return "; ".join(f"{mood}: {', '.join(names)}" for mood, names in by_mood().items())


@lru_cache(maxsize=1)
def fonts_css() -> str:
    """The `@font-face` rules. `font-display: swap` shows text at once in a
    fallback and switches when the file arrives."""
    rules = []
    for entry in catalogue():
        for face in entry["faces"]:
            rules.append(
                f'@font-face{{font-family:"{entry["family"]}";font-style:normal;'
                f'font-weight:{face["weight"]};font-display:swap;'
                f'src:url("/_ctrlai/fonts/{face["file"]}") format("woff2")}}'
            )
    return "\n".join(rules) + "\n"


def file_path(name: str) -> Path | None:
    """The file for a request, only when the manifest lists it."""
    if not FILE_PATTERN.match(name):
        return None
    if not any(face["file"] == name for entry in catalogue() for face in entry["faces"]):
        return None
    return FONT_DIR / name


@lru_cache(maxsize=1)
def _family_pattern() -> re.Pattern[str]:
    # Longest names first, so "Nanum Gothic Coding" is not read as "Nanum Gothic".
    names = sorted(families(), key=len, reverse=True)
    return re.compile(r"(?<![\w-])(" + "|".join(re.escape(name) for name in names) + r")(?![\w-])", re.IGNORECASE)


def used_in(files: dict[str, str]) -> bool:
    """Does any of the app's html, css or js name a catalogue family?"""
    pattern = _family_pattern()
    return any(
        pattern.search(content)
        for path, content in files.items()
        if path.lower().endswith(_TEXT_SUFFIXES)
    )
