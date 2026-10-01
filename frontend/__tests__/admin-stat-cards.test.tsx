/**
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
  },
  {
    user_id: 2,
    username: "minho",
    display_name: "박민호",
    role: "member",
    account_status: "active",
    membership_status: "inactive",
  },
  {
    user_id: 3,
    username: "sora",
    display_name: "이소라",
    role: "member",
    account_status: "active",
    membership_status: null,
  },
  {
    user_id: 4,
    username: "gone",
    display_name: "떠난회원",
    role: "member",
    account_status: "former",
    membership_status: "former",
  },
  {
    user_id: 5,
    username: "admin",
    display_name: "관리담당",
    role: "admin",
    account_status: "active",
    membership_status: "active",
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
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/members",
  useSearchParams: () => new URLSearchParams(),
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

vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));

const { default: MemberList } = await import("@/app/admin/members/MemberList");

/** 카드는 숫자와 이름이 한 단추 안에 들어 있습니다. */
function card(label: string) {
  return screen
    .getAllByRole("button")
    .find((button) => button.textContent?.includes(label))!;
}

function rows() {
  return screen.getAllByRole("row").slice(1); // 머리글 줄 제외
}

describe("회원 숫자 카드", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listQuarterMembers.mockResolvedValue(MEMBERS);
    getMemberStats.mockResolvedValue(STATS);
  });

  test("백엔드가 준 숫자를 그대로 보여 준다", async () => {
    render(<MemberList />);
    await screen.findByText("김유리");

    // 목록을 세지 않고 받은 값을 씁니다 — 거르기를 걸어 두면 목록은
    // "전체"가 아니기 때문입니다.
    expect(card("전체 회원")!.textContent).toContain("4");
    expect(card("비활동")!.textContent).toContain("1");
    expect(card("탈퇴")!.textContent).toContain("1");
    expect(card("관리자")!.textContent).toContain("1");
  });

  test("활동 회원 카드를 누르면 활동 회원만 남는다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");
    expect(rows()).toHaveLength(5);

    await user.click(card("활동 회원")!);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByText("김유리")).toBeTruthy();
    expect(screen.getByText("관리담당")).toBeTruthy();
    expect(screen.queryByText("박민호")).toBeNull();
  });

  test("비활동 카드를 누르면 비활동 회원만 남는다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(card("비활동")!);

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText("박민호")).toBeTruthy();
  });

  test("미신청 카드는 참여 기록이 없는 회원만 남긴다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(card("미신청")!);

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText("이소라")).toBeTruthy();
  });

  test("탈퇴 카드는 탈퇴 회원만 남긴다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(card("탈퇴")!);

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText("떠난회원")).toBeTruthy();
  });

  test("관리자 카드는 관리자만 남긴다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(card("관리자")!);

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText("관리담당")).toBeTruthy();
  });

  test("카드를 바꿔 누르면 앞의 거르기가 남지 않는다", async () => {
    /**
     * 카드마다 거르는 축이 다릅니다 — 탈퇴는 계정 상태, 관리자는 역할.
     * 둘이 겹쳐 걸리면 아무도 나오지 않고, 왜인지도 보이지 않습니다.
     */
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(card("관리자")!);
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.click(card("탈퇴")!);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText("떠난회원")).toBeTruthy();
  });

  test("고른 카드는 눌린 상태로 표시되고, 풀 수 있다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(card("비활동")!);
    await waitFor(() => expect(card("비활동")!.getAttribute("aria-pressed")).toBe("true"));

    // 걸 수 있으면 풀 수도 있어야 합니다.
    await user.click(screen.getByRole("button", { name: /전체 보기/ }));
    await waitFor(() => expect(rows()).toHaveLength(5));
  });

  test("거르기를 걸어도 카드의 숫자는 전체를 가리킨다", async () => {
    const user = userEvent.setup();
    render(<MemberList />);
    await screen.findByText("김유리");

    await user.click(card("비활동")!);
    await waitFor(() => expect(rows()).toHaveLength(1));

    // 목록은 한 줄이지만 "전체 회원"은 여전히 4입니다. 화면에서 세면
    // 이 숫자가 1이 되고, 카드가 거짓말을 하게 됩니다.
    expect(within(card("전체 회원")!).getByText("4")).toBeTruthy();
  });
});
