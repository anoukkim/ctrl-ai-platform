/**
 * admin-consolidation v3 (2): 회원 목록의 칩 — 전체 · 승인 대기 · 활동 · 미참여 —
 * 과 사용률 열, 줄에서 승인/거절. (예전 숫자 카드는 칩이 됐어요.)
 *
 * 숫자 카드를 누르면 목록이 걸러지는지.
 *
 * 카드가 숫자만 보여 준다면 장식입니다. 누를 수 있다고 해 놓고 아무 일도
 * 일어나지 않거나, 엉뚱한 줄이 남는 쪽이 더 나쁩니다 — 관리자는 걸러진
 * 목록을 보고 "비활동 회원은 이 사람뿐"이라고 판단하기 때문입니다.
 *
 * 그래서 증명하는 것은 셋입니다: 누르면 걸러지고, 강조 표시가 따라붙고,
 * 다시 풀 수 있다.
 *
 * 숫자 자체가 데이터베이스와 맞는지는 백엔드 테스트가 봅니다
 * (`backend/tests/test_admin_stats.py`). 여기서는 화면이 그 숫자를 어떻게
 * 쓰는지만 봅니다.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { MemberWithMembership, Quarter } from "@/lib/quarters";

const QUARTER: Quarter = {
  id: 1,
  code: "2026-Q1",
  display_name: "2026 Q1",
  starts_at: "2026-01-01",
  ends_at: "2026-03-31",
  application_opens_at: "2025-12-01",
  application_closes_at: "2025-12-31",
  status: "application_open",
  subsidy_limit_krw: 100_000,
};

/** 카드마다 한 명씩. 그래야 거르기가 통했는지 한 줄로 확인됩니다. */
const MEMBERS: MemberWithMembership[] = [
  {
    user_id: 1,
    username: "yuri",
    display_name: "김유리",
    role: "member",
    account_status: "active",
    membership_status: "active",
    application_status: "approved",
    budget_krw: 80_000,
    consumed_krw: 68_800,
  },
  {
    user_id: 2,
    username: "minho",
    display_name: "박민호",
    role: "member",
    account_status: "active",
    membership_status: "inactive",
    application_status: "approved",
  },
  {
    user_id: 3,
    username: "sora",
    display_name: "이소라",
    role: "member",
    account_status: "active",
    membership_status: null,
    application_status: null,
  },
  {
    // 신청은 했지만 아직 승인 전 — 미참여이지만 미신청은 아닙니다 (owner-polish 8).
    user_id: 6,
    username: "pending",
    display_name: "대기중",
    role: "member",
    account_status: "active",
    membership_status: null,
    application_status: "submitted",
    application_id: 9,
    requested_budget_krw: 80_000,
  },
  {
    user_id: 4,
    username: "gone",
    display_name: "떠난회원",
    role: "member",
    account_status: "former",
    // 탈퇴 회원: 참여 기록도 신청도 없지만 미신청에는 세지 않습니다 (카드와 같게).
    membership_status: null,
    application_status: null,
  },
  {
    user_id: 5,
    username: "admin",
    display_name: "관리담당",
    role: "admin",
    account_status: "active",
    membership_status: "active",
    // 관리자가 직접 넣은 사람 — 신청 없이 활동 중. 미신청에 세지 않습니다.
    application_status: null,
    budget_krw: 80_000,
    consumed_krw: 11_200,
  },
];

const STATS = {
  total: 4,
  active: 2,
  inactive: 1,
  not_applied: 1,
  former: 1,
  admins: 1,
};

const listQuarterMembers = vi.fn().mockResolvedValue(MEMBERS);
const getMemberStats = vi.fn().mockResolvedValue(STATS);
const reviewApplication = vi.fn().mockResolvedValue({});
let search = new URLSearchParams();

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getMemberStats: (...args: unknown[]) => getMemberStats(...args) };
});

vi.mock("@/lib/quarters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quarters")>();
  return {
    ...actual,
    listQuarterMembers: (...args: unknown[]) => listQuarterMembers(...args),
    setQuarterMembership: vi.fn(),
    reviewApplication: (...args: unknown[]) => reviewApplication(...args),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/members",
  useSearchParams: () => search,
}));

vi.mock("@/app/admin/AdminQuarterProvider", () => ({
  useAdminQuarter: () => ({
    quarters: [QUARTER],
    selected: QUARTER,
    select: vi.fn(),
    dashboard: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    error: null,
  }),
  withQuarter: (href: string) => href,
}));

vi.mock("@/app/admin/admin.module.css", () => ({ default: { usageCell: "usageCell" } }));

const { default: MemberList } = await import("@/app/admin/members/MemberList");

function rows() {
  return screen.getAllByRole("row").slice(1); // 머리글 줄 제외
}

describe("회원 목록의 칩과 사용률 (admin-consolidation v3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search = new URLSearchParams();
    listQuarterMembers.mockResolvedValue(MEMBERS);
    reviewApplication.mockResolvedValue({});
  });

  const chip = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });

  test("칩마다 수가 있고, 누르면 그 사람들만 남는다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(chip("전체").textContent).toContain("6");
    expect(chip("승인 대기").textContent).toContain("1");
    expect(chip("참여 중").textContent).toContain("2");
    expect(chip("미참여").textContent).toContain("2");

    await user.click(chip("참여 중"));
    expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining("관리담당"), expect.stringContaining("김유리")]);
    expect(chip("참여 중").getAttribute("aria-pressed")).toBe("true");
    await user.click(chip("미참여"));
    // 미참여: no participation and not waiting, former members aside.
    expect(rows().map((row) => row.textContent?.includes("박민호") || row.textContent?.includes("이소라"))).toEqual([true, true]);
  });

  test("승인 대기 줄에서 바로 승인하고, 대시보드의 링크는 그 칩을 연다", async () => {
    search = new URLSearchParams("filter=pending");
    const user = userEvent.setup();
    render(<MemberList />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].textContent).toContain("승인 대기");
    await user.click(within(rows()[0]).getByRole("button", { name: "승인" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "승인" }));
    await waitFor(() => expect(reviewApplication).toHaveBeenCalledWith(9, true, ""));
  });

  test("사용률: 막대와 %, 80% 이상은 주황; 지갑이 없으면 —", async () => {
    render(<MemberList />);
    await waitFor(() => expect(rows()).toHaveLength(6));
    const yuri = rows().find((row) => row.textContent?.includes("김유리"))!;
    expect(yuri.textContent).toContain("86%");
    expect(yuri.querySelector("[data-warn='true']")).not.toBeNull();
    const admin = rows().find((row) => row.textContent?.includes("관리담당"))!;
    expect(admin.textContent).toContain("14%");
    expect(admin.querySelector("[data-warn='true']")).toBeNull();
    expect(rows().find((row) => row.textContent?.includes("이소라"))!.textContent).toContain("—");
  });

  test("비활동으로 둔 뒤 신청한 회원도 승인 대기 — 줄에서 사유와 함께 거절", async () => {
    listQuarterMembers.mockResolvedValue([
      ...MEMBERS.filter((member) => member.user_id !== 2),
      { ...MEMBERS[1], application_status: "submitted", application_id: 12, requested_budget_krw: 80_000 },
    ]);
    search = new URLSearchParams("filter=pending");
    const user = userEvent.setup();
    render(<MemberList />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    const minho = rows().find((row) => row.textContent?.includes("박민호"))!;
    expect(minho.textContent).toContain("승인 대기");
    await user.click(within(minho).getByRole("button", { name: "거절" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "예산이 모두 배정됨");
    await user.click(within(dialog).getByRole("button", { name: "거절" }));
    await waitFor(() => expect(reviewApplication).toHaveBeenCalledWith(12, false, "예산이 모두 배정됨"));
  });
});
