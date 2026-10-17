/**
 * admin-consolidation v3 (1) — the Dashboard: 처리할 일 (zeros hidden) and
 * the automatic alerts.
 */
import { describe, expect, test } from "vitest";

import { alertsOf, todosOf } from "@/app/admin/AdminDashboard";
import type { AdminDashboard } from "@/lib/admin";

const BASE = {
  quarter: null,
  pending_applications: 0,
  pending_top_ups: 0,
  counts: { accounts: {}, membership: {}, total: 0 },
  members: {},
  applications: {},
  quarter_stats: null,
  video_models_total: 0,
  video_models_member_visible: 0,
  recent_audit: [],
  is_development: false,
  failing_providers: [],
} as unknown as AdminDashboard;

describe("처리할 일", () => {
  test("0인 일은 없고, 승인 대기는 Members › 참여 신청으로, 신고는 Community로", () => {
    expect(todosOf(BASE)).toEqual([]);
    const todos = todosOf({ ...BASE, pending_applications: 2, open_reports: 1 });
    expect(todos.map((t) => [t.label, t.count, t.href])).toEqual([
      ["참여 신청 승인 대기", 2, "/admin/members?tab=applications&status=submitted"],
      ["열린 신고", 1, "/admin/community"],
    ]);
  });
});

describe("알림", () => {
  test("80%를 넘은 지원금, Anthropic 달 예산, 서버 썸네일 — 기준을 넘을 때만 경고", () => {
    const alerts = alertsOf({
      ...BASE,
      wallet_alerts: [{ user_id: 4, username: "minji", display_name: "민지", used_pct: 86, remaining_krw: 11200 }],
      anthropic_month: { month: "2026-10", used_usd: 71, budget_usd: 100, used_pct: 71 },
      thumbnail_server: "ok",
    });
    expect(alerts.map((a) => [a.text, a.tone])).toEqual([
      ["민지 · 지원금 86% 사용", "warn"],
      ["Anthropic 이번 달 예산 71%", "info"],
      ["서버 썸네일 정상", "ok"],
    ]);
    expect(alerts[0].href).toBe("/admin/members/4");
    const over = alertsOf({ ...BASE, anthropic_month: { month: "2026-10", used_usd: 90, budget_usd: 100, used_pct: 90 }, thumbnail_server: "down" });
    expect(over.map((a) => a.tone)).toEqual(["warn", "warn"]);
    // No monthly budget set, the browser takes pictures: nothing to say.
    expect(alertsOf({ ...BASE, anthropic_month: { month: "2026-10", used_usd: 3, budget_usd: null, used_pct: null }, thumbnail_server: "off" })).toEqual([]);
  });
});
