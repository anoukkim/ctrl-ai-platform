/**
 * admin-consolidation v3 (3) — 사용 분석 and the member's 사용 내역 show the
 * ledger's figures: 원가 and 청구 side by side, shares, tops, the trend.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { MemberUsage, QuarterAnalysis } from "@/lib/accounting";
import type { Quarter } from "@/lib/quarters";

const QUARTER: Quarter = {
  id: 4, code: "2026-Q4", display_name: "2026 Q4", starts_at: "2026-10-01", ends_at: "2026-12-31",
  application_opens_at: null, application_closes_at: null, status: "active", subsidy_limit_krw: 80_000,
};

const ANALYSIS: QuarterAnalysis = {
  cost_usd: 61.2, cost_krw: 89_100, charged_krw: 96_410, cache_saved_krw: 6_200,
  providers: [{ provider: "claude", label: "Claude (Anthropic)", cost_usd: 61.2, charged_krw: 89_100, remaining_usd: 188.8, runs_out_on: "2026-12-09" }],
  by_feature: [{ label: "Project Builder", krw: 55_900, pct: 58 }, { label: "Chat", krw: 32_800, pct: 34 }],
  by_model: [{ model_id: "claude-sonnet-5-5", label: "Sonnet 5.5", krw: 71_300, input_tokens: 1, output_tokens: 1 }],
  top_apps: [{ id: 7, name: "동아리 게시판", krw: 1_240 }],
  top_members: [{ id: 3, name: "민지", krw: 68_800 }],
  daily: [{ day: "2026-10-16", krw: 100 }, { day: "2026-10-17", krw: 300 }],
  forecast_krw: 412_000,
  runs_out_on: "2026-12-09",
};

const USAGE: MemberUsage = {
  budget_krw: 80_000, used_krw: 68_800, remaining_krw: 11_200, used_pct: 86, calls: 41, runs_out_on: "2026-11-20",
  by_feature: [{ label: "Project Builder", krw: 41_200, pct: 60 }],
  by_model: [{ model_id: "claude-sonnet-5-5", label: "Sonnet 5.5", krw: 59_100, input_tokens: 1_500_000, output_tokens: 400_000 }],
  recent: [{ when: "2026-10-17T03:00:00Z", place: "Chat", model: "Sonnet 5.5", krw: 120 }],
};

vi.mock("@/lib/accounting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting")>()),
  getUsageAnalysis: async () => ANALYSIS,
  getMemberUsage: async () => USAGE,
  getCredit: async () => ({ providers: [], purchases: [], report_provider: "mock" }),
}));
vi.mock("@/app/admin/AdminQuarterProvider", () => ({
  useAdminQuarter: () => ({ quarters: [QUARTER], selected: QUARTER, select: vi.fn(), dashboard: null, refresh: vi.fn(), error: null }),
  useAdminQuarterOptional: () => null,
  withQuarter: (href: string) => href,
}));
vi.mock("@/app/admin/budget/CreditPanel", () => ({ default: () => null }));
vi.mock("@/app/admin/budget/CachePanel", () => ({ default: () => null }));
vi.mock("@/app/admin/budget/ReconcilePanel", () => ({ default: () => null }));

const { default: UsageAnalysis } = await import("@/app/admin/quarters/UsageAnalysis");
const { default: MemberUsagePanel } = await import("@/app/admin/members/[id]/MemberUsagePanel");

describe("사용 분석", () => {
  test("원가와 청구를 나란히, 기능별 · 모델별 · TOP 5 · 추이, Concur CSV", async () => {
    render(<UsageAnalysis />);
    const page = await screen.findByTestId("usage-analysis");
    expect(page.textContent).toContain("89,100원");
    expect(page.textContent).toContain("96,410원");
    const providers = within(screen.getByRole("table")).getAllByRole("row");
    expect(providers[1].textContent).toContain("$188.80");
    expect(page.textContent).toContain("Project Builder");
    expect(page.textContent).toContain("58%");
    expect(screen.getByRole("link", { name: "동아리 게시판" }).getAttribute("href")).toBe("/admin/apps/7");
    expect(screen.getByRole("link", { name: "민지" }).getAttribute("href")).toBe("/admin/members?member=3");
    expect(screen.getByRole("img", { name: /지난 2일 청구 400원/ })).toBeTruthy();
    expect(page.textContent).toContain("분기 말 예상 412,000원");
  });
});

describe("회원의 사용 내역", () => {
  test("사용 · 사용률 · 남음 · 호출 · 소진 예상, 모델별 토큰, 최근 호출", async () => {
    render(<MemberUsagePanel userId={3} />);
    await waitFor(() => expect(screen.getByTestId("member-usage").textContent).toContain("68,800원"));
    const text = screen.getByTestId("member-usage").textContent ?? "";
    expect(text).toContain("86%");
    expect(text).toContain("11,200원");
    expect(text).toContain("41");
    expect(text).toContain("190만");
    expect(text).toContain("Chat");
  });
});
