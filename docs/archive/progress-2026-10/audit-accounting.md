# Accounting audit — cost-clarity (a), 2026-10-14

Owner's instruction: *accuracy audit first: every charge path through
`usage.charge()`; per-event round-up; `provider_cost` vs `charged_krw`;
cache write/read prices per model (incl. Haiku 4.5's 4,096-token minimum —
a prompt below it is never billed as a cache read); web search / fetch /
code-execution costs; failed / cut-off calls. Fix real bugs with tests.*

Sources checked live on 2026-10-14 (WebFetch):
[pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool),
[Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api),
[Cost report reference](https://platform.claude.com/docs/en/api/beta/organization/cost_report/retrieve).
Tests: `backend/tests/test_cost_clarity.py` (24) plus the updated
`test_builder_starter.py`, `test_live_cost.py`, `test_usage.py`.

## Summary

| # | Area | Finding | Action |
| - | ---- | ------- | ------ |
| 1 | Charge paths | Every paid action reaches `usage.charge()` (one lock, one ledger row): chat reply, Builder starter, video prompt helper, video generate / edit / extend. No other code moves `consumed_krw`. | none — confirmed by grep and tests |
| 2 | Round-up | Each event is `ceil(total USD × rate)` once, minimum 1원; the web-search fee is rounded up on its own and added, so a tooled reply can be up to 1원 more than one combined ceil. Members are never charged less than the cost. | documented; the receipt now says the total is rounded up |
| 3 | `provider_cost` vs `charged_krw` | Kept apart as designed. The only place `charged_krw` < cost is `cap_to_available` (a concurrent charge emptied the wallet mid-stream) — `provider_cost` keeps the full figure, so the shortfall is visible. | none |
| 4 | Cache prices | Catalogue matches the live pricing page: Haiku 4.5 $1 in / $1.25 5m write / $0.10 read / $5 out; Sonnet 5.5 $2 / $2.50 / **$0.10** (0.05×) / $10; Opus 5.5 $4 / $5 / **$0.20** (0.05×) / $20. Writes are 1.25× (5m) or 2× (1h) in code. (The bundled SDK reference still says Sonnet 5.5 reads at $0.20 — stale; the live page wins, as the morning's PART F fix assumed.) | none; test pins the arithmetic |
| 5 | Haiku 4.5 minimum | 4,096 tokens (live page). Charges use the counts the API reports, so a short Haiku prompt — `cache_creation` and `cache_read` both 0 — is billed as plain input by construction. The mock models the same minimum. | new test: three short Haiku turns record 0 read / 0 write / 0 saved |
| 6 | Sonnet/Opus 5.5 minimum | 512 tokens; the mock's default is 512. | none |
| 7 | Web search | $10 / 1,000 searches; a failed search is not billed. We count `server_tool_use.web_search_requests` from the final usage, which excludes failures. | none |
| 8 | **Web fetch on Haiku — bug** | `web_fetch_20260209` (dynamic filtering) needs a Claude 4.6+ model; we sent it to Haiku 4.5 too, which the real API would refuse (400) the first time a member used 페이지 읽기 on Haiku. Free of charge either way (fetch has no fee). | **fixed**: `web_fetch_tool_type()` → `web_fetch_20250910` on Haiku; test |
| 9 | Code execution | Free when a `_20260209` web tool is in the same request; otherwise billed by container time, **$0.05 / hour after 1,550 free hours a month per organisation**. Not charged to members (no per-call fee to pass on). With 40 members the free hours are far from reached. It appears in Anthropic's cost report as "Code Execution Usage" and in no ledger row — reconciliation would show it. | documented; no change |
| 10 | **Prompt helper — bug** | Priced input and output only. It sends no cache marker today, but if the API ever reported cache tokens they would be dropped (under-charge). | **fixed**: all four kinds priced and stored; test with a fake transport reporting cache tokens |
| 11 | **Failed-after-billing Builder calls — gap** | A starter generation cut off (`max_tokens`), refused, returning invalid JSON or unusable files was already billed by Anthropic but left **no record**: the member was (correctly) not charged, and the club's spend was invisible. | **fixed**: `usage.record_absorbed()` writes a `club_absorbed` row (`charged_krw` 0, `provider_cost` = the club's cost); never shown to the member; counted in Admin › Budget's 사용; tests for cut-off, refusal, unusable files, and "a provider error records nothing" |
| 12 | Chat errors mid-stream | A stream that errors after `message_start` charges nothing (Phase 2's rule). Whether Anthropic bills those partial tokens is not documented; if it does, reconciliation shows it as a small daily gap. | documented; no change |
| 13 | Stopped replies | Input from `message_start`; output = max(reported, one token per received character) — generous, never under. | none |
| 14 | Cache-write TTL | Priced by the configured TTL; both breakpoints use the same TTL, so the `cache_creation.ephemeral_5m/1h` breakdown would add nothing. | none |
| 15 | Thinking | Thinking tokens arrive in `output_tokens` and are billed as output. | none (chat-thinking-view adds `thinking_shown`) |
| 16 | **신청 마감 — bug** | Admin › Quarters' 신청 마감 set the quarter to `closed`. `current_quarter()` only offers `application_open` or `active`, so pressing it stopped **every wallet** (members got "지금은 진행 중인 분기가 없습니다"). | **fixed**: 신청 마감 → `active`; `closed` only through 분기 마감 (which freezes and records 회수); the PATCH route refuses `closed` and refuses reopening a closed quarter; tests |
| 17 | Wallet overwrite | `PUT …/allocations/{user}` overwrote `budget_krw`. | **replaced** by `POST …/adjustments` (+/− with a required reason, a row each, audited; refused below what is already spent and on a frozen wallet) |
| 18 | Video | Charged at the catalogue's won price; `provider_cost` is null (mock). Admin › Budget shows video in won only and says so. When the real Higgsfield adapter lands, record its credits as `provider_cost` (budget-by-provider point 2). | documented |

## What a member and the owner now see

* **Every Claude charge** stores its dollar cost by part — input, cache
  write, cache read, output, tools — and `cache_saved_usd` (read tokens ×
  (input price − read price)). The won parts are unrounded; the charged
  total is their sum rounded up once.
* **Receipt** under each reply: 입력 / 캐시 쓰기 / 캐시 읽기 / 출력 / 도구 /
  합계 in won, "캐시로 아낀 금액 약 N원" and an ⓘ with the two-sentence
  explanation. Tokens are in the tooltip.
* **Usage**: this quarter's cache saving, 대화별 and 날짜별 (KST) tables
  with the same parts; 빌더 is its own line in "어디에 썼나요".
* **Admin › Budget**: 지급 vs 사용; 동아리 크레딧 per provider (append-only
  purchases, ledger use, estimated remaining — "Anthropic 콘솔이 최종
  기준"); 회원별 (채팅/빌더/영상/기타, 캐시 절약, 조정, 이월, 회수); the
  caching panel; CSV exports (UTF-8 with BOM); reconciliation against
  Anthropic's cost report (mock unless an Admin API key is configured).

Rows written before cost-clarity have no stored split. They are re-priced
from today's catalogue for display and marked 어림/estimated — never
rewritten.
