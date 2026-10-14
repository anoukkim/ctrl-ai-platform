/**
 * single-wallet — 회원에게 지원금 지갑은 하나입니다.
 *
 * 증명하는 것:
 *   - 참여 신청에는 나눌 것이 없다(비율, 미리 정한 배분이 없다).
 *   - Usage는 지갑 하나와 "어디에 썼나요"(채팅/영상/기타, 정보용)를 보여 준다.
 *   - 버튼 옆 예상 비용은 그 하나의 잔액과 비교된다.
 *   - Admin › Budget은 제공자별 사용액과 회원별 지갑을 보여 준다.
 *
 * 금액이 맞는지는 백엔드 테스트가 봅니다. 여기서는 화면이 그 숫자를
 * 어떻게 보여 주는지만 봅니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  compareToWallet,
  walletSentence,
  type MyQuarterStatus,
  type MyUsage,
  type Quarter,
  type QuarterBudget,
} from "@/lib/quarters";

const QUARTER: Quarter = {
  id: 7,
  code: "2026-Q4",
  display_name: "2026 Q4",
  starts_at: "2026-10-01",
  ends_at: "2026-12-31",
  application_opens_at: "2026-09-15",
  application_closes_at: "2026-09-30",
  status: "application_open",
  subsidy_limit_krw: 80_000,
};

const applyForQuarter = vi.fn().mockResolvedValue({});
const getMyQuarter = vi.fn();
const getMyUsage = vi.fn();
const getQuarterBudget = vi.fn();

vi.mock("@/lib/quarters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quarters")>();
  return {
    ...actual,
    applyForQuarter: (...args: unknown[]) => applyForQuarter(...args),
    getMyQuarter: (...args: unknown[]) => getMyQuarter(...args),
    getMyUsage: (...args: unknown[]) => getMyUsage(...args),
    getQuarterBudget: (...args: unknown[]) => getQuarterBudget(...args),
  };
});

// cost-clarity: Budget also reads the club's credit and the per-member table.
vi.mock("@/lib/accounting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accounting")>();
  return {
    ...actual,
    getCredit: vi.fn().mockResolvedValue({ providers: [], purchases: [], report_provider: "mock" }),
    getQuarterMoney: vi.fn().mockResolvedValue({
      quarter_id: 7,
      quarter_name: "2026 Q4",
      closed_at: null,
      carry_over_percent: 0,
      granted_krw: 80_000,
      charged_krw: 27_700,
      unspent_krw: 52_300,
      cache_saved_krw: 120.5,
      absorbed_usd: "0.00",
      members: [
        {
          user_id: 2, username: "yuri", display_name: "김유리", membership_status: "active",
          granted_krw: 80_000, consumed_krw: 27_700, remaining_krw: 52_300, chat_krw: 12_700,
          build_krw: 0, video_krw: 15_000, other_krw: 0, cache_saved_krw: 120.5, adjusted_krw: 0,
          carried_in_krw: 0, frozen: false, reclaimed_krw: null, carry_over_krw: null,
        },
      ],
    }),
    getCachePanel: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/app/admin/AdminQuarterProvider", () => ({
  useAdminQuarter: () => ({
    quarters: [QUARTER],
    selected: QUARTER,
    select: vi.fn(),
    dashboard: null,
    refresh: vi.fn(),
    error: null,
  }),
  withQuarter: (href: string) => href,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/budget",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: QuarterParticipation } = await import("@/app/profile/QuarterParticipation");
const { default: UsageView } = await import("@/app/usage/UsageView");
const { default: BudgetAdmin } = await import("@/app/admin/budget/BudgetAdmin");

function myQuarter(overrides: Partial<MyQuarterStatus> = {}): MyQuarterStatus {
  return {
    quarter: QUARTER,
    application: null,
    allocation: null,
    personal: { balance_krw: 0, consumed_krw: 0, remaining_krw: 0, overage_enabled: false },
    participation: "신청 가능",
    days_remaining: 80,
    membership_status: null,
    may_create: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("참여 신청", () => {
  test("나눌 것 없이 '이번 분기 참여' 한 번으로 분기 금액을 신청한다", async () => {
    getMyQuarter.mockResolvedValue(myQuarter());
    const user = userEvent.setup();
    render(<QuarterParticipation />);

    expect(await screen.findByText(/80,000원/)).toBeTruthy();
    // 비율을 고르는 것이 하나도 없다.
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByText(/Build/)).toBeNull();
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "이번 분기 참여" }));

    expect(applyForQuarter).toHaveBeenCalledTimes(1);
    expect(applyForQuarter).toHaveBeenCalledWith(QUARTER.id);
  });

  test("승인되면 지갑 하나를 보여 주고, 개인 충전이 꺼져 있으면 쓰는-순서 문장은 없다", async () => {
    // personal-topup-off (2026-10-14): 기본값에서는 개인 사용 스위치를
    // 소개하지 않습니다 — 백엔드가 403으로 막는 스위치입니다.
    getMyQuarter.mockResolvedValue(
      myQuarter({
        participation: "활동 회원",
        allocation: {
          id: 1,
          quarter_id: QUARTER.id,
          budget_krw: 80_000,
          consumed_krw: 27_700,
          remaining_krw: 52_300,
          approved_at: "2026-10-01T00:00:00Z",
        },
      }),
    );
    render(<QuarterParticipation />);

    expect(await screen.findByText("이번 분기 지원금 80,000원 중 52,300원 남음")).toBeTruthy();
    expect(screen.getByText(/모든 기능이 이 지원금 하나에서 차감됩니다/)).toBeTruthy();
    expect(screen.queryByText(/동아리 지원금을 먼저 씁니다/)).toBeNull();
  });
});

describe("Usage", () => {
  const usage: MyUsage = {
    quarter_code: "2026-Q4",
    quarter_name: "2026 Q4",
    days_remaining: 80,
    membership_status: "active",
    wallet: { budget_krw: 80_000, consumed_krw: 27_700, remaining_krw: 52_300 },
    breakdown: [
      { group: "chat", label: "채팅", consumed_krw: 12_200 },
      { group: "video", label: "영상", consumed_krw: 15_000 },
      { group: "other", label: "기타", consumed_krw: 500 },
    ],
    personal: { balance_krw: 0, consumed_krw: 0, remaining_krw: 0, overage_enabled: false },
    events: [
      {
        id: 1,
        created_at: "2026-10-02T00:00:00Z",
        funding_source: "community",
        provider: "claude",
        feature: "chat",
        model_id: "claude-sonnet-5-5",
        charged_krw: 20,
        group: "chat",
        label: "Chat — 여행 계획",
      },
    ],
  };

  test("지갑 하나, 그 문장, 그리고 채팅/영상/기타 내역", async () => {
    getMyUsage.mockResolvedValue(usage);
    render(<UsageView />);

    expect(await screen.findByText("이번 분기 지원금 80,000원 중 52,300원 남음")).toBeTruthy();
    expect(screen.getByText("52,300원")).toBeTruthy();
    expect(screen.getByText("어디에 썼나요")).toBeTruthy();
    expect(screen.getByText("12,200원")).toBeTruthy();
    expect(screen.getByText("15,000원")).toBeTruthy();
    // Build/Video 두 카드는 더 이상 없다.
    expect(screen.queryByText("Build")).toBeNull();
    expect(screen.queryByText("Video")).toBeNull();
    // 개인 충전이 꺼져 있는 동안(personal-topup-off, 기본값) 쓰는-순서
    // 문장은 개인 잔액 구역과 함께 보이지 않습니다 — 켜진 화면은
    // beta-launch.test.tsx가 봅니다.
    expect(screen.queryByText(/동아리 지원금을 먼저 씁니다/)).toBeNull();
    expect(screen.queryByText("개인 잔액")).toBeNull();
  });

  test("승인된 지갑이 없으면 그렇게 말한다", async () => {
    getMyUsage.mockResolvedValue({ ...usage, wallet: null, breakdown: [], events: [] });
    render(<UsageView />);

    expect(await screen.findByText(/아직 승인된 지원금이 없습니다/)).toBeTruthy();
  });
});

describe("예상 비용과 지갑", () => {
  const wallet = { remaining_krw: 3_000 };
  const off = { remaining_krw: 50_000, overage_enabled: false };
  const on = { remaining_krw: 50_000, overage_enabled: true };

  test("남은 지원금 안이면 잔액만 알린다", () => {
    expect(compareToWallet(2_500, wallet, off)).toEqual({
      tone: "ok",
      text: "남은 지원금 3,000원",
    });
  });

  test("채팅이 쓰고 남은 지원금이 영상 한 번보다 적으면 부족하다고 말한다", () => {
    expect(compareToWallet(3_500, wallet, off)?.tone).toBe("short");
    expect(compareToWallet(3_500, wallet, off)?.text).toContain("지원금이 부족합니다");
  });

  test("개인 사용을 켰고 개인 잔액이 넉넉하면 개인 잔액에서 결제된다고 말한다", () => {
    expect(compareToWallet(3_500, wallet, on)?.tone).toBe("personal");
  });

  test("지갑이 없으면 아무것도 말하지 않는다", () => {
    expect(compareToWallet(3_500, null, on)).toBeNull();
  });

  test("사이드바와 Usage가 같은 문장을 쓴다", () => {
    expect(walletSentence({ budget_krw: 80_000, remaining_krw: 52_300 })).toBe(
      "이번 분기 지원금 80,000원 중 52,300원 남음",
    );
  });
});

describe("Admin › Budget", () => {
  const budget: QuarterBudget = {
    quarter: QUARTER,
    member_budget_krw: 80_000,
    anthropic_month_usd: 0,
    anthropic_month_budget_usd: null,
    anthropic_month: "2026-10",
    wallets: [
      {
        user_id: 2,
        username: "yuri",
        display_name: "김유리",
        account_status: "active",
        membership_status: "active",
        budget_krw: 80_000,
        consumed_krw: 27_700,
        remaining_krw: 52_300,
      },
    ],
    total_budget_krw: 80_000,
    total_consumed_krw: 27_700,
    total_remaining_krw: 52_300,
    providers: [
      {
        provider: "higgsfield",
        label: "Higgsfield",
        events: 3,
        charged_krw: 15_000,
        community_krw: 15_000,
        personal_krw: 0,
        provider_cost: {},
        units: { seconds: 25 },
        input_tokens: 0,
        output_tokens: 0,
        cache_write_tokens: 0,
        cache_read_tokens: 0,
        cache_hit_rate: null,
        share: 0.55,
        share_of_wallets_krw: 44_000,
      },
      {
        provider: "claude",
        label: "Claude (Anthropic)",
        events: 40,
        charged_krw: 12_700,
        community_krw: 12_700,
        personal_krw: 0,
        provider_cost: { USD: "9.07" },
        units: { tokens: 300_000 },
        input_tokens: 25_000,
        output_tokens: 50_000,
        cache_write_tokens: 50_000,
        cache_read_tokens: 175_000,
        cache_hit_rate: 0.7,
        share: 0.45,
        share_of_wallets_krw: 36_000,
      },
    ],
    total_charged_krw: 27_700,
  };

  test("제공자별 사용액과 회원별 지갑을 보여 준다", async () => {
    getQuarterBudget.mockResolvedValue(budget);
    render(<BudgetAdmin />);

    await waitFor(() => expect(getQuarterBudget).toHaveBeenCalledWith(QUARTER.id));
    expect(await screen.findByText("Claude (Anthropic)")).toBeTruthy();
    expect(screen.getByText("Higgsfield")).toBeTruthy();
    expect(screen.getByText("$9.07")).toBeTruthy();
    expect(screen.getByText("55%")).toBeTruthy();
    expect(screen.getByText("김유리")).toBeTruthy();
    expect(screen.getByText("1인 지원금 80,000원")).toBeTruthy();
    // prompt-caching: how much of Claude's input came from the cache.
    expect(screen.getByText(/캐시 읽기 175,000 · 쓰기 50,000 토큰 \(입력의 70% 캐시\)/)).toBeTruthy();
  });
});
