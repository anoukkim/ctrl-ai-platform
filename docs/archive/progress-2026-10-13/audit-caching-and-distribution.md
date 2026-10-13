# audit-caching-and-distribution — checklist (PART F, owner 2026-10-14)

Branch `audit-caching-and-distribution` from `feat-chat-plus-tools`.

## F1 — prompt caching: prove it

1. `docs/progress/audit-caching.md`: per catalogue model — minimum
   cacheable length, lifetime/refresh, write/read pricing vs input,
   breakpoints, invalidators — citing the official page.
2. Code vs docs: the two breakpoints and where; byte-stable prefix across
   turns (system prompt, history joins, tool list); model/tool/thinking
   toggles; whether the system prompt is long enough per model (Haiku
   4.5 needs 4,096 — documented, not forced); stepped trimming.
3. Catalogue price fix: Sonnet 5.5 cache read 0.20 → **0.10 $/MTok**
   (docs: 0.05× of $2); seed + data migration touching only rows still
   holding the old seeded value.
4. Tests: byte-identical cached prefix across two consecutive turns;
   multipliers vs the docs; (existing) each cache figure priced at its
   own rate, hit cheaper than no hit.
5. Admin: per-model, per-day cache stats — requests, hit rate, tokens
   read, won saved — in Admin › AI Models › 비용 보정.
6. The real-key two-message morning check written for the MORNING doc.

## F2 — API distribution

7. `docs/api-distribution.md` (Korean): one club key, attribution, the
   wallet as the per-member limit, worst/expected cost formulas (40-member
   example), protections, out-of-credit behaviour, Console-side rules,
   later providers. Linked from README and deployment.md.
8. Global concurrency limit on outgoing provider calls: provider
   concurrency in the chat-limits setting (Admin › System, audited),
   default 3 per server process (documented honestly for 2 workers),
   bounded wait then Korean refusal; enforced around every provider call
   (chat stream, prompt helper, builder starter). Tests.
9. Out-of-credit: mock `[mock-error:credit]` path proves the member sees
   Korean, nothing is charged, no retry storm (SDK max_retries=1);
   the dashboard alert now says why (last error kind label). Tests.
10. `ANTHROPIC_MONTHLY_BUDGET_USD` (env, default off) → Admin › Budget
    progress bar with the 80% warning. Test.

## Status — loop results (2026-10-14)

- Every checklist point built. Backend full suite green in this worktree
  with the PostgreSQL tests running (`ctrlai_f_test` on the throwaway
  server); frontend 349 vitest / tsc 0 / eslint 0. `npm run build` not
  run here (worktree) — run on main at merge time.
- **Browser check skipped** on the coordinator's priority call (time):
  the two new admin views are covered by vitest (캐시 절약 table, the
  budget bar renders only with the setting) and the endpoints by pytest.
  Worth one click after merging.
- Base state at finish: branched from `feat-chat-plus-tools` `d03680c`;
  merged `main` (docs only). The tools branch's expected round-2
  amendments had not landed; if its migration d9e2f7a4c3b8 is amended
  in place later, recreate any database that ran the old file.
- Two pre-existing tests updated for new behaviour: the dashboard alert
  now carries the reason ("Claude — 키가 잘못되었거나 만료") and the
  chat-limits admin API requires `provider_concurrency`.
- Open design note: the cap vs tool-result-tokens question the main
  session logged for the owner is untouched by this branch — my cap
  additions only reserve the deterministic search fees, same as the
  tools branch decided.
