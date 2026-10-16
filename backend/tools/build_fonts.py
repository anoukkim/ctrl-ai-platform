"""Build the member-app font catalogue (feat-app-fonts).

Reads the original OFL font files from a folder, cuts each down to the
glyphs an app screen needs (the 2,350 KS X 1001 Hangul syllables, Hangul
jamo, Latin, numbers, punctuation and common symbols), writes WOFF2 files
to `backend/app/static/fonts/` and rewrites `manifest.json` beside them.

    pip install fonttools brotli          # development only
    python -I backend/tools/build_fonts.py <folder with the .ttf files>

Adding a font = download it (OFL only), add one row to `FONTS`, run this.
`app/services/app_fonts.py` reads the manifest; nothing else changes.
The folder you pass is untrusted input: this script only reads font files.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent.parent / "app" / "static" / "fonts"

# (family, 분위기 category, [(source file, weight, output slug)])
# A variable font gives its weight range as "100 900".
FONTS: list[tuple[str, str, list[tuple[str, str, str]]]] = [
    ("Pretendard", "고딕", [("PretendardVariable.woff2", "45 920", "pretendard")]),
    ("Noto Sans KR", "고딕", [("NotoSansKR[wght].ttf", "100 900", "noto-sans-kr")]),
    ("Nanum Gothic", "고딕", [("NanumGothic-Regular.ttf", "400", "nanum-gothic-400"), ("NanumGothic-Bold.ttf", "700", "nanum-gothic-700")]),
    ("Gothic A1", "고딕", [("GothicA1-Regular.ttf", "400", "gothic-a1-400"), ("GothicA1-Bold.ttf", "700", "gothic-a1-700")]),
    ("IBM Plex Sans KR", "고딕", [("IBMPlexSansKR-Regular.ttf", "400", "ibm-plex-sans-kr-400"), ("IBMPlexSansKR-Bold.ttf", "700", "ibm-plex-sans-kr-700")]),
    ("Gowun Dodum", "고딕", [("GowunDodum-Regular.ttf", "400", "gowun-dodum")]),
    ("Jua", "둥글고 귀여운", [("Jua-Regular.ttf", "400", "jua")]),
    ("Gamja Flower", "둥글고 귀여운", [("GamjaFlower-Regular.ttf", "400", "gamja-flower")]),
    ("Gaegu", "둥글고 귀여운", [("Gaegu-Regular.ttf", "400", "gaegu-400"), ("Gaegu-Bold.ttf", "700", "gaegu-700")]),
    ("Hi Melody", "둥글고 귀여운", [("HiMelody-Regular.ttf", "400", "hi-melody")]),
    ("Single Day", "둥글고 귀여운", [("SingleDay-Regular.ttf", "400", "single-day")]),
    ("Dongle", "둥글고 귀여운", [("Dongle-Regular.ttf", "400", "dongle-400"), ("Dongle-Bold.ttf", "700", "dongle-700")]),
    ("Cute Font", "둥글고 귀여운", [("CuteFont-Regular.ttf", "400", "cute-font")]),
    ("Poor Story", "둥글고 귀여운", [("PoorStory-Regular.ttf", "400", "poor-story")]),
    ("Sunflower", "둥글고 귀여운", [("Sunflower-Light.ttf", "300", "sunflower-300"), ("Sunflower-Medium.ttf", "500", "sunflower-500"), ("Sunflower-Bold.ttf", "700", "sunflower-700")]),
    ("Black Han Sans", "굵은 제목용", [("BlackHanSans-Regular.ttf", "400", "black-han-sans")]),
    ("Do Hyeon", "굵은 제목용", [("DoHyeon-Regular.ttf", "400", "do-hyeon")]),
    ("Bagel Fat One", "굵은 제목용", [("BagelFatOne-Regular.ttf", "400", "bagel-fat-one")]),
    ("Gasoek One", "굵은 제목용", [("GasoekOne-Regular.ttf", "400", "gasoek-one")]),
    ("Gugi", "굵은 제목용", [("Gugi-Regular.ttf", "400", "gugi")]),
    ("Noto Serif KR", "명조·단정", [("NotoSerifKR[wght].ttf", "200 900", "noto-serif-kr")]),
    ("Nanum Myeongjo", "명조·단정", [("NanumMyeongjo-Regular.ttf", "400", "nanum-myeongjo-400"), ("NanumMyeongjo-Bold.ttf", "700", "nanum-myeongjo-700")]),
    ("Gowun Batang", "명조·단정", [("GowunBatang-Regular.ttf", "400", "gowun-batang-400"), ("GowunBatang-Bold.ttf", "700", "gowun-batang-700")]),
    ("Hahmlet", "명조·단정", [("Hahmlet[wght].ttf", "100 900", "hahmlet")]),
    ("Song Myung", "명조·단정", [("SongMyung-Regular.ttf", "400", "song-myung")]),
    ("Nanum Pen Script", "손글씨", [("NanumPenScript-Regular.ttf", "400", "nanum-pen-script")]),
    ("Nanum Brush Script", "손글씨", [("NanumBrushScript-Regular.ttf", "400", "nanum-brush-script")]),
    ("East Sea Dokdo", "손글씨", [("EastSeaDokdo-Regular.ttf", "400", "east-sea-dokdo")]),
    ("Dokdo", "손글씨", [("Dokdo-Regular.ttf", "400", "dokdo")]),
    ("Yeon Sung", "손글씨", [("YeonSung-Regular.ttf", "400", "yeon-sung")]),
    ("Black And White Picture", "손글씨", [("BlackAndWhitePicture-Regular.ttf", "400", "black-and-white-picture")]),
    ("Nanum Gothic Coding", "코드·고정폭", [("NanumGothicCoding-Regular.ttf", "400", "nanum-gothic-coding-400"), ("NanumGothicCoding-Bold.ttf", "700", "nanum-gothic-coding-700")]),
]


def keep_text() -> str:
    """The characters every cut keeps."""
    chars = [chr(c) for c in range(0x20, 0x7F)]  # Basic Latin
    chars += [chr(c) for c in range(0xA0, 0x100)]  # Latin-1
    chars += [chr(c) for c in range(0x2010, 0x2060)]  # punctuation
    chars += [chr(c) for c in range(0x2190, 0x21FF)]  # arrows
    chars += [chr(c) for c in range(0x2460, 0x2500)]  # circled numbers and the like
    chars += [chr(c) for c in range(0x25A0, 0x2640)]  # shapes, stars, hearts
    chars += [chr(c) for c in range(0x3000, 0x3040)]  # CJK punctuation
    chars += [chr(c) for c in range(0x3130, 0x3190)]  # Hangul compatibility jamo
    for lead in range(0xB0, 0xC9):  # KS X 1001 syllables
        for trail in range(0xA1, 0xFF):
            try:
                chars.append(bytes([lead, trail]).decode("euc-kr"))
            except UnicodeDecodeError:
                pass
    return "".join(chars)


def name_of(font: TTFont, name_id: int) -> str:
    record = font["name"].getName(name_id, 3, 1, 0x409) or font["name"].getName(name_id, 1, 0, 0)
    return str(record).strip() if record else ""


def main(src: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    text = keep_text()
    manifest = []
    for family, mood, faces in FONTS:
        rows = []
        copyright_ = ""
        for source, weight, slug in faces:
            options = subset.Options()
            options.flavor = "woff2"
            options.layout_features = ["*"]
            options.notdef_outline = True
            options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
            font = subset.load_font(str(src / source), options)
            copyright_ = copyright_ or name_of(font, 0)
            subsetter = subset.Subsetter(options)
            subsetter.populate(text=text)
            subsetter.subset(font)
            target = OUT / f"{slug}.woff2"
            subset.save_font(font, str(target), options)
            rows.append({"file": f"{slug}.woff2", "weight": weight})
            print(f"{target.name:40} {target.stat().st_size // 1024:6} KB")
        manifest.append({"family": family, "mood": mood, "license": "OFL-1.1", "copyright": copyright_, "faces": rows})
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
