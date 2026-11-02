# 1차 모임 발표자료 — 2026-11-04

The presentation page for the first all-member meeting, copied from the
Artifact "CTRL+AI 시연" (version 1793659542-0c83, 2026-11-02) so it can be
opened on any computer.

| File | What it is |
| --- | --- |
| `index.html` | The presentation: real ctrlai.my screens in a Chrome-window frame. Tabs 시작하기 · 채팅에서 앱까지 · 남이 만든 앱의 AI · 화면 둘러보기 · 움짤 · 대본 |
| `script.md` | The 5-minute Korean script (same text as the page's 「대본」 tab) |
| `v2/img/` | 55 screenshots the page plays |
| `v2/gif/` | 6 GIF clips (the 「움짤」 tab) |

## How to run it

On any computer, after `git pull` / `git checkout docs-first-meeting-presentation`:

```sh
cd docs/first-meeting/presentation
python3 -m http.server 8000
# open http://localhost:8000
```

Double-clicking `index.html` also works. No internet needed; only the
IBM Plex font comes from Google Fonts, and without it the page falls back
to the system Korean font.

Keys: `←` `→` change scene · `Space` play/pause. Open a tab directly with
`#start`, `#demo`, `#others`, `#tour`, `#gif` or `#script`.

## What is in the screens

시작하기 and the admin screens were recorded on the **local copy** with test
data (test member 민지, invite codes `DEV-WELCOME` / `DEV-TRY-ONCE`); the rest
is ctrlai.my as member `anoukkim`. No real invite codes or other members'
details appear. Notes and caveats: [`../README.md`](../README.md).
