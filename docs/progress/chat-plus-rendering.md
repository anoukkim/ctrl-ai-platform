# chat-plus-rendering — checklist

Branch `feat-chat-plus-rendering`. Spec: `docs/BACKLOG.md` › chat-plus-rendering
(and "Chat+ — what the three M1 items share").

## Requirements

1. Replies render Markdown: headings, lists, bold, links, GFM tables, fenced code.
2. One renderer: `react-markdown` + `remark-gfm` (new dependencies).
3. No raw HTML — an HTML tag in a reply shows as text.
4. Links open in a new tab with `rel="noopener noreferrer"`; only `http(s)`
   and `mailto` survive.
5. Wide tables scroll inside their own box; the page never scrolls sideways.
6. Code blocks show the language and a **복사** button ("복사됨" for two
   seconds); monospace from `--mono`; no syntax highlighting.
7. System prompt: Markdown is rendered; a table when comparing/organising, a
   fenced block for code, few headings; still Korean, still beginner-level.
8. 기능 둘러보기 replaces the four welcome cards: same grid and tokens; four
   example prompts that **fill the composer** and send nothing:
   표 만들기, 파일 요약 (paste text until chat-plus-files), 차트 그리기
   (a table + a one-line reading until chat-plus-artifacts), 웹페이지 만들기
   (a code block until chat-plus-artifacts).
9. The card list lives in `lib/chat-examples.ts`, not `mock-data.ts`.
10. The old destinations stay reachable (sidebar, reply action buttons).
11. Streaming stays smooth: an unfinished fence renders as a code block, an
    unfinished table does not flash raw pipes.
12. Mock first: the mock Claude gains canned replies with a table, a code
    block, an HTML page and an SVG chart.
13. Charging unchanged; `CHAT_MAX_OUTPUT_TOKENS` stays 4,096.

## Tests named by the spec

14. A table, a code block and a list render as elements, not text.
15. `<script>` and `<img onerror>` in a reply render as text.
16. A `javascript:` link is dropped.
17. 복사 writes the block's exact text to the clipboard (mocked).
18. A half-streamed fence renders as code.
19. Each example card fills the composer and sends nothing.
20. The system prompt no longer says "does not render Markdown" (backend).

## Status — self-review against the diff

1. ✅ `frontend/app/components/ChatMarkdown.tsx` — react-markdown + remark-gfm; used for assistant bubbles in `ChatWorkspace.tsx`.
2. ✅ `frontend/package.json` — `react-markdown` ^10.1.0, `remark-gfm` ^4.0.1.
3. ✅ `htmlAsText` remark plugin turns `html` nodes into text (block HTML wrapped in a paragraph).
4. ✅ `safeUrl` (`urlTransform`) keeps only `http(s)://` and `mailto:`; the `a` component adds `target="_blank" rel="noopener noreferrer"`; a dropped link renders as plain text. Images are not loaded (alt text instead) so no remote request leaves the page.
5. ✅ `.tableWrap { overflow-x: auto }`; `.bubble { max-width: 100%; min-width: 0 }`. Browser check: 0 px page overflow and 0 px sideways thread scroll at 390 px.
6. ✅ `CodeBlock` — language label (or 코드), 복사 → 복사됨 for 2 s (복사하지 못했어요 on failure), `font-family: var(--mono)`, no highlighting.
7. ✅ `backend/app/services/claude_provider.py` CHAT_SYSTEM_PROMPT rule rewritten; the rest of the prompt (Korean, beginner level) unchanged.
8. ✅ `ChatWorkspace.tsx` 기능 둘러보기 heading + four buttons in the old grid/tokens; `fillExample` sets the draft and focuses, sends nothing; disabled for a member not taking part this quarter.
9. ✅ `frontend/lib/chat-examples.ts`; `CHAT_SHORTCUTS` removed from `mock-data.ts`.
10. ✅ Sidebar unchanged; reply action buttons unchanged.
11. ✅ `prepareStreaming` closes an open fence and holds back a table until its divider row has arrived.
12. ✅ `_MOCK_TABLE`, `_MOCK_PAGE` (HTML code block), `_MOCK_CHART` (table + one-line reading + SVG code block), `_MOCK_SUMMARY`, checked before the routing rules.
13. ✅ No change to charging or `CHAT_MAX_OUTPUT_TOKENS`.
14–19. ✅ `frontend/__tests__/chat-plus-rendering.test.tsx`.
20. ✅ `backend/tests/test_chat.py::test_the_system_prompt_says_markdown_is_rendered` (+ the mock reply tests).

Also fixed (found in the browser check, older than this item): on phones
the conversation was drawn in the left 236 px only — the container query
tried to change the container's own grid, which CSS ignores. `.chat` now
spans both columns under the query.

Docs: `docs/product.md` › Chat.

## Review

- Round 1 — 12 findings: single `~` struck out (high), single line breaks
  lost, whole history re-rendered per streamed piece, canned mock replies
  shadowing builder/usage routing, charts not explained, caret on its own
  line, copy timer after unmount, a card wiping typed text, copy wording.
  Fixed; two left by choice (disabled cards for a non-participating
  member — the spec's rule; footnote anchors — fixed later in round 2).
- Round 2 — 7: Markdown links froze the stream in the action-marker
  filter (older code, now common); a closing fence added inside a list
  made an empty code box; heading-underline and language-label flashes;
  mock examples still caught some app requests; cards stacking; English
  footnote label. Fixed; the caret after a final table/list left as is.
- Round 3 — 4: an overlong marker title could stream onto the screen;
  footnote ids dropped by the link component; Korean footnote labels;
  duplicate `footnote-label` ids. Fixed.
- Round 4 — clean apart from 2 low, fixed.
