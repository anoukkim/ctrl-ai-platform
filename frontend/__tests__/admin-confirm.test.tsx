/**
 * 변경 앞에 확인창이 뜨는지.
 *
 * admin-restructure가 요구한 테스트입니다. 사람이 눈으로 한 번 확인하는
 * 것으로는, 다음에 누군가 확인창을 지나치는 길을 만들어도 아무것도
 * 막지 못합니다.
 *
 * 증명하려는 것은 두 가지입니다.
 *
 *   1. 메뉴에서 고른 것만으로는 **아무 일도 일어나지 않는다**. 바뀌는
 *      일은 확인을 누른 뒤에만 일어납니다.
 *   2. 확인창에 적힌 것이 "정말로 하시겠습니까?"가 아니라 **무슨 일이
 *      생기는지**다. 확인창의 값은 멈추는 데 있는 것이 아니라, 멈춘 동안
 *      읽을 내용에 있습니다.
 *
 * 백엔드는 부르지 않습니다. 바뀌는 호출은 가짜로 바꿔 두고, 그것이
 * 불렸는지만 봅니다 — 테스트가 네트워크를 타면 백엔드가 꺼져 있을 때
 * 실패하고, 그러면 테스트가 무엇을 증명하는지 알 수 없습니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
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

const MEMBER: MemberWithMembership = {
  user_id: 7,
  username: "yuri",
  display_name: "김유리",
  role: "member",
  account_status: "active",
  membership_status: "active",
};

/**
 * 가짜로 바꿔 두는 것들.
 *
 * `setQuarterMembership`이 진짜 변경입니다. 나머지는 화면이 그려지기만
 * 하면 되는 것들이라 고정된 값을 돌려 줍니다.
 */
const setQuarterMembership = vi.fn().mockResolvedValue(MEMBER);
const listQuarterMembers = vi.fn().mockResolvedValue([MEMBER]);
const refreshDashboard = vi.fn().mockResolvedValue(undefined);
const push = vi.fn();

vi.mock("@/lib/quarters", async (importOriginal) => {
  // 문구 표(MEMBERSHIP_LABEL 등)는 진짜를 그대로 씁니다. 가짜로 적어 두면
  // 화면에 실제로 어떤 한국어가 나오는지 테스트가 증명하지 못합니다.
  const actual = await importOriginal<typeof import("@/lib/quarters")>();
  return {
    ...actual,
    listQuarterMembers: (...args: unknown[]) => listQuarterMembers(...args),
    setQuarterMembership: (...args: unknown[]) => setQuarterMembership(...args),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/members",
  useSearchParams: () => new URLSearchParams(),
}));

// 회원 목록은 Admin 레이아웃 안의 분기 제공자를 읽습니다. 레이아웃까지
// 그리지 않고 그 값만 내어 줍니다.
vi.mock("@/app/admin/AdminQuarterProvider", () => ({
  useAdminQuarter: () => ({
    quarters: [QUARTER],
    selected: QUARTER,
    select: vi.fn(),
    dashboard: null,
    refresh: refreshDashboard,
    error: null,
  }),
  withQuarter: (href: string) => href,
}));

// CSS 모듈은 jsdom에서 의미가 없어 이름만 돌려 줍니다.
vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));

const { default: MemberList } = await import("@/app/admin/members/MemberList");

describe("회원 목록의 참여 상태 변경", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listQuarterMembers.mockResolvedValue([MEMBER]);
    setQuarterMembership.mockResolvedValue(MEMBER);
  });

  test("메뉴에서 고르면 확인창이 먼저 뜨고, 그 전에는 아무것도 바뀌지 않는다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);

    // 목록이 들어오기를 기다립니다.
    await screen.findByText("김유리");

    await user.click(screen.getByRole("button", { name: /관리/ }));
    await user.click(screen.getByRole("menuitem", { name: "비활동으로" }));

    // 확인창이 떴고,
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();

    // 아직 아무것도 바뀌지 않았습니다. 이것이 이 테스트의 핵심입니다.
    expect(setQuarterMembership).not.toHaveBeenCalled();
  });

  test("확인창은 무슨 일이 생기는지 한국어로 적는다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(screen.getByRole("button", { name: /관리/ }));
    await user.click(screen.getByRole("menuitem", { name: "탈퇴 처리" }));

    const dialog = await screen.findByRole("dialog");
    // 탈퇴의 실제 결과가 적혀 있어야 합니다 — 로그인할 수 없다는 것.
    expect(dialog.textContent).toContain("로그인할 수 없습니다");
    // 그리고 작품의 이름은 남는다는 것. 되돌릴 수 없는 일처럼 보이는
    // 작업에서 관리자가 가장 알고 싶어 하는 부분입니다.
    expect(dialog.textContent).toContain("탈퇴 회원");
  });

  test("확인을 누르면 그때 바뀌고, 결과가 화면에 적힌다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(screen.getByRole("button", { name: /관리/ }));
    await user.click(screen.getByRole("menuitem", { name: "비활동으로" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "비활동으로" }));

    await waitFor(() => {
      expect(setQuarterMembership).toHaveBeenCalledWith(QUARTER.id, MEMBER.user_id, "inactive");
    });

    // 조용히 성공하면 아무 일도 없었던 화면과 구분되지 않습니다.
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("비활동");
  });

  test("취소를 누르면 아무것도 바뀌지 않고 창이 닫힌다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(screen.getByRole("button", { name: /관리/ }));
    await user.click(screen.getByRole("menuitem", { name: "비활동으로" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(setQuarterMembership).not.toHaveBeenCalled();
  });
});
