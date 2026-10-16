"""feat-app-fonts: the Korean font catalogue served to member apps.

The point of the tests: apps get real font files from their own origin, the
CSP stays exactly as it was, and an app that names no catalogue font is
left alone.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from fontTools.ttLib import TTFont

from app.services import app_fonts, app_runtime, app_shell, claude_provider


def test_every_manifest_file_exists_and_is_a_woff2() -> None:
    for entry in app_fonts.catalogue():
        assert entry["license"] == "OFL-1.1" and entry["faces"]
        for face in entry["faces"]:
            path = app_fonts.file_path(face["file"])
            assert path is not None and path.read_bytes()[:4] == b"wOF2", face["file"]


def test_the_files_still_hold_hangul() -> None:
    """The cut keeps the 2,350 everyday syllables — checked on a sentence
    from the apps that started this."""
    for entry in app_fonts.catalogue():
        cmap = TTFont(app_fonts.file_path(entry["faces"][0]["file"])).getBestCmap()
        assert all(ord(c) in cmap for c in "10초 계란요리 명예의 프라이팬"), entry["family"]


def test_each_family_has_its_licence_text_beside_the_files() -> None:
    assert "SIL Open Font License" in (app_fonts.FONT_DIR / "OFL.txt").read_text(encoding="utf-8")
    assert all(entry["copyright"] for entry in app_fonts.catalogue())


def test_the_css_names_every_file_by_the_same_origin_path() -> None:
    css = app_fonts.fonts_css()
    for entry in app_fonts.catalogue():
        for face in entry["faces"]:
            assert f'url("/_ctrlai/fonts/{face["file"]}")' in css
    # Nothing outside the app's own origin: that is what keeps the CSP unchanged.
    assert "http" not in css and "//" not in css.replace("/_ctrlai/", "")


@pytest.mark.parametrize("name", ["../manifest.json", "manifest.json", "jua.ttf", "nope.woff2", "JUA.woff2", "%2e%2e"])
def test_only_listed_files_are_served(name: str) -> None:
    assert app_fonts.file_path(name) is None


def test_the_routes_serve_css_and_files_publicly(anon_client: TestClient) -> None:
    css = anon_client.get("/_ctrlai/fonts.css")
    assert css.status_code == 200 and css.headers["content-type"].startswith("text/css")
    assert css.headers["access-control-allow-origin"] == "*"
    font = anon_client.get("/_ctrlai/fonts/jua.woff2")
    assert font.status_code == 200 and font.content[:4] == b"wOF2"
    assert font.headers["content-type"] == "font/woff2"
    assert font.headers["access-control-allow-origin"] == "*"
    assert font.headers["cross-origin-resource-policy"] == "cross-origin"
    assert anon_client.get("/_ctrlai/fonts/manifest.json").status_code == 404
    assert anon_client.get("/_ctrlai/fonts/unknown.woff2").status_code == 404
    # Not under the site's /api, like the other platform files.
    assert anon_client.get("/api/_ctrlai/fonts.css").status_code == 404


def test_the_csp_did_not_widen() -> None:
    """Fonts come from the app's own origin, which the policy already allowed."""
    assert "font-src 'self' data:;" in app_shell.app_files_csp("https://ctrlai.my")


def test_an_app_that_names_a_font_gets_the_stylesheet() -> None:
    plain = {"index.html": "<html><head><title>a</title></head><body>안녕</body></html>", "style.css": "body{color:red}"}
    using = {**plain, "style.css": 'h1{font-family:"Jua", sans-serif}'}
    assert not app_fonts.used_in(plain)
    assert app_fonts.used_in(using)
    page = app_runtime.with_shim("index.html", plain["index.html"], fonts=True)
    assert page.index(app_runtime.SDK_TAG) < page.index(app_fonts.FONTS_TAG) < page.index("<title>")
    assert app_fonts.FONTS_TAG not in app_runtime.with_shim("index.html", plain["index.html"])


def test_family_names_are_matched_as_whole_names() -> None:
    assert app_fonts.used_in({"a.css": "p{font-family:'jua'}"})
    assert app_fonts.used_in({"a.css": 'p{font-family:"Nanum Gothic Coding"}'})
    assert not app_fonts.used_in({"a.css": ".jua-like{color:red}  /* dokdoish */"})
    assert not app_fonts.used_in({"notes.md": "Jua"})


def test_the_builder_prompts_list_the_catalogue() -> None:
    for prompt in (claude_provider.STARTER_SYSTEM, claude_provider._SDK_RULES):
        for family in app_fonts.families():
            assert family in prompt, family
    assert "no web fonts or CDNs" not in claude_provider.STARTER_SYSTEM
