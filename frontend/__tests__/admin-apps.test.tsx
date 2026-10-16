/**
 * Admin › Apps (app-platform P4b) — 목록과 Content의 축소.
 *
 * 목록은 게시 여부와 상관없이 기능 상자를 쓴 앱을 한 줄씩, AI 사용은
 * 방문자(오늘 · 이번 분기)와 만든 사람의 미리보기를 따로 보여 줍니다.
 * Content에는 신고 표만 남고 앱 표는 없습니다.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import AdminContentPage from "@/app/admin/content/page";
import AppsList from "@/app/admin/apps/AppsList";

const listAdminAppOverview = vi.fn();
const listAppReports = vi.fn();

vi.mock("@/lib/apps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apps")>();
  return {
    ...actual,
    listAdminAppOverview: () => listAdminAppOverview(),
    listAppReports: () => listAppReports(),
  };
});

vi.mock("@/app/components/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/apps",
  useSearchParams: () => new URLSearchParams(),
}));

const ROWS = [
  {
    id: 5,
    name: "동아리 게시판",
    published: true,
    slug: "abcdefgh23",
    app_url: "http://apps.test/abcdefgh23/",
    version_number: 3,
    published_at: new Date().toISOString(),
    owner_id: 2,
    owner_username: "minji",
    owner_name: "민지",
    example: false,
    sdk_enabled: true,
    sdk_disabled_reason: "",
    open_reports: 1,
    consents: 3,
    data_items: 12,
    data_bytes: 3 * 1024,
    ai: { today_calls: 2, today_krw: 24, quarter_calls: 9, quarter_krw: 110, preview_quarter_calls: 1, preview_quarter_krw: 7 },
    updated_at: new Date().toISOString(),
  },
  {
    id: 8,
    name: "내 초안",
    published: false,
    slug: null,
    app_url: null,
    version_number: null,
    published_at: null,
    owner_id: 1,
    owner_username: "dev",
    owner_name: "개발자",
    example: true,
    sdk_enabled: false,
    sdk_disabled_reason: "확인 중",
    open_reports: 0,
    consents: 1,
    data_items: 0,
    data_bytes: 0,
    ai: { today_calls: 0, today_krw: 0, quarter_calls: 0, quarter_krw: 0, preview_quarter_calls: 4, preview_quarter_krw: 31 },
    updated_at: new Date().toISOString(),
  },
];

beforeEach(() => {
  listAdminAppOverview.mockReset().mockResolvedValue(ROWS);
  listAppReports.mockReset().mockResolvedValue([]);
});

describe("Admin › Apps", () => {
  test("게시된 앱과 미게시 앱이 한 줄씩, AI는 방문자와 미리보기를 따로", async () => {
    render(<AppsList />);
    const rows = await screen.findAllByRole("row");
    const text = rows.map((row) => row.textContent ?? "");
    const board = text.find((t) => t.includes("동아리 게시판"))!;
    expect(board).toContain("게시 v3");
    expect(board).toContain("9회 · 110원");
    expect(board).toContain("2회 · 24원");
    expect(board).toContain("1회 · 7원");
    expect(board).toContain("3명");
    expect(board).toContain("12개 · 3.0 KB");
    const draft = text.find((t) => t.includes("내 초안"))!;
    expect(draft).toContain("미게시");
    expect(draft).toContain("예시 앱");
    expect(draft).toContain("기능 상자 멈춤");
    expect(draft).toContain("4회 · 31원");
    // 줄은 앱 상세로 이어집니다.
    const links = screen.getAllByRole("link", { name: /동아리 게시판/ });
    expect(links.some((link) => link.getAttribute("href") === "/admin/apps/5")).toBe(true);
  });

  test("Content에는 신고 표만 남고 앱 표는 없다", async () => {
    render(<AdminContentPage />);
    expect(await screen.findByText("열린 신고가 없습니다.")).toBeTruthy();
    expect(screen.queryByTestId("published-apps")).toBeNull();
    expect(screen.getByRole("link", { name: "Apps" }).getAttribute("href")).toBe("/admin/apps");
  });
});
