/**
 * cost-clarity (2026-10-14) — 돈이 어디로 갔는지, 화면 쪽.
 *
 * 증명하는 것:
 *   - 답장 영수증이 입력 / 캐시 쓰기 / 캐시 읽기 / 출력 / 도구 / 합계를 원으로
 *     보여 주고, 캐시로 아낀 금액과 ⓘ 설명(두 문장)이 붙는다.
 *   - 원 단위 항목이 없는 옛 응답은 토큰 줄로 돌아간다.
 *   - Usage가 이번 분기 캐시로 아낀 금액, 대화별, 날짜별 표를 보여 준다.
 *   - Budget의 동아리 크레딧 카드와 구매 기록(확인 창을 거쳐서만 보냄).
 *   - 회원 상세의 지원금 조정은 +/− 금액과 사유, 쓴 돈보다 많이 못 뺀다.
 *   - 분기 마감 창은 미리보기를 보여 주고 이월 비율을 보낸다.
 *
 * 금액 계산이 맞는지는 백엔드 테스트(test_cost_clarity.py)가 봅니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { receiptLine } from "@/app/components/ChatWorkspace";
import type { ReplyReceipt } from "@/lib/chat";
import { CACHE_EXPLAINER, formatWonPart, splitLine } from "@/lib/money";

const accounting = vi.hoisted(() => ({
  recordPurchase: vi.fn(),
  getClosePreview: vi.fn(),
  closeQuarter: vi.fn(),
}));

vi.mock("@/lib/accounting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accounting")>();
  return {
    ...actual,
    recordPurchase: (...args: unknown[]) => accounting.recordPurchase(...args),
    getClosePreview: (...args: unknown[]) => accounting.getClosePreview(...args),
    closeQuarter: (...args: unknown[]) => accounting.closeQuarter(...args),
  };
});

const quarters = vi.hoisted(() => ({ getMyUsage: vi.fn() }));
vi.mock("@/lib/quarters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quarters")>();
  return { ...actual, getMyUsage: (...args: unknown[]) => quarters.getMyUsage(...args) };
});

vi.mock("@/app/components/SiteProvider", () => ({
  useSiteLoaded: () => true,
  useSite: () => ({ top_ups_enabled: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const RECEIPT: ReplyReceipt = {
  input_tokens: 40,
  output_tokens: 420,
  cache_write_tokens: 120,
  cache_read_tokens: 2_400,
  web_search_count: 0,
  tool_fee_krw: 0,
  charged_krw: 7,
  input_krw: 0.11,
  cache_write_krw: 0.42,
  cache_read_krw: 0.34,
  output_krw: 5.88,
  tool_krw: 0,
  cache_saved_krw: 6.38,
  split_estimated: false,
};

describe("답장 영수증", () => {
  test("원 단위 항목과 합계", () => {
    expect(receiptLine(RECEIPT)).toBe(
      "입력 0.1원 · 캐시 쓰기 0.4원 · 캐시 읽기 0.3원 · 출력 5.9원 · 합계 7원",
    );
  });

  test("도구를 쓴 답장은 도구 줄이 붙는다", () => {
    expect(
      receiptLine({ ...RECEIPT, web_search_count: 2, tool_fee_krw: 28, tool_krw: 28 }),
    ).toContain("도구 28원 (검색 2회)");
  });

  test("캐시가 꺼져 있던 답장에는 캐시 칸이 없다", () => {
    const line = receiptLine({ ...RECEIPT, cache_write_tokens: null, cache_read_tokens: null });
    expect(line).not.toContain("캐시");
  });

  test("원 단위가 없는 옛 응답은 토큰 줄", () => {
    const { input_krw: _unused, ...old } = RECEIPT;
    void _unused;
    expect(receiptLine(old as ReplyReceipt)).toContain("입력 160토큰");
  });

  test("항목 금액 표기", () => {
    expect(formatWonPart(0)).toBe("0원");
    expect(formatWonPart(0.04)).toBe("0.1원 미만");
    expect(formatWonPart(5.88)).toBe("5.9원");
    expect(formatWonPart(1234.4)).toBe("1,234원");
    expect(
      splitLine({
        input_krw: 1, cache_write_krw: 0, cache_read_krw: 0, output_krw: 12, tools_krw: 0,
        other_krw: 0, cache_saved_krw: 0, charged_krw: 13, events: 1, estimated: false,
      }),
    ).toBe("입력 1원 · 출력 12원");
  });

  test("ⓘ 설명은 두 문장", () => {
    expect(CACHE_EXPLAINER.split(/(?<=요\.)\s/).length).toBe(2);
  });
});

describe("Usage — 돈이 어디로 갔나요", () => {
  test("이번 분기 캐시 절약, 대화별, 날짜별", async () => {
    const split = (charged: number, saved: number) => ({
      input_krw: 1.2, cache_write_krw: 3.4, cache_read_krw: 0.5, output_krw: 20, tools_krw: 0,
      other_krw: 0, cache_saved_krw: saved, charged_krw: charged, events: 3, estimated: false,
    });
    quarters.getMyUsage.mockResolvedValue({
      quarter_code: "2026-Q4",
      quarter_name: "2026 Q4",
      days_remaining: 70,
      membership_status: "active",
      wallet: { budget_krw: 80_000, consumed_krw: 27, remaining_krw: 79_973 },
      breakdown: [
        { group: "chat", label: "채팅", consumed_krw: 27 },
        { group: "build", label: "빌더", consumed_krw: 0 },
        { group: "video", label: "영상", consumed_krw: 0 },
        { group: "other", label: "기타", consumed_krw: 0 },
      ],
      personal: null,
      events: [],
      money: {
        quarter: split(27, 9.5),
        by_conversation: [
          { conversation_id: 5, title: "여행 계획", last_at: "2026-10-14T01:00:00Z", split: split(20, 9.5) },
          { conversation_id: null, title: "삭제된 대화", last_at: "2026-10-13T01:00:00Z", split: split(7, 0) },
        ],
        by_day: [{ day: "2026-10-14", split: split(27, 9.5) }],
      },
    });
    const { default: UsageView } = await import("@/app/usage/UsageView");
    render(<UsageView />);

    expect((await screen.findByTestId("quarter-cache-saved")).textContent).toBe("약 9.5원");
    expect(screen.getByText("빌더")).toBeTruthy();
    expect(screen.getByText("여행 계획")).toBeTruthy();
    expect(screen.getByText("삭제된 대화")).toBeTruthy();
    expect(screen.getByTestId("money-by-day").textContent).toContain("2026.10.14");

    await userEvent.click(screen.getByRole("button", { name: "캐시가 무엇인가요?" }));
    expect(screen.getByText(CACHE_EXPLAINER)).toBeTruthy();
  });
});

describe("Budget — 동아리 크레딧", () => {
  const CREDIT = {
    providers: [
      {
        provider: "claude", label: "Claude (Anthropic)", purchased_usd: "10.00", paid_krw: 14_350,
        purchases: 1, used_usd: "1.25", absorbed_usd: "0.05", used_krw: 1_800,
        used_usd_quarter: "1.25", used_krw_quarter: 1_800, remaining_usd: "8.75", unpriced_events: 0,
      },
      {
        provider: "higgsfield", label: "Higgsfield", purchased_usd: "0.00", paid_krw: 0, purchases: 0,
        used_usd: "0.00", absorbed_usd: "0.00", used_krw: 3_500, used_usd_quarter: "0.00",
        used_krw_quarter: 3_500, remaining_usd: "0.00", unpriced_events: 1,
      },
    ],
    purchases: [
      {
        id: 1, provider: "claude", provider_label: "Claude (Anthropic)", purchased_on: "2026-10-14",
        amount_usd: "10.00", paid_krw: 14_350, memo: "첫 구매", created_by_username: "admin",
        created_at: "2026-10-14T01:00:00Z",
      },
    ],
    report_provider: "mock",
  };

  test("구매·사용·남은 크레딧(추정)과, 확인 창을 거친 구매 기록", async () => {
    accounting.recordPurchase.mockResolvedValue({});
    const onChanged = vi.fn();
    const { default: CreditPanel } = await import("@/app/admin/budget/CreditPanel");
    render(<CreditPanel credit={CREDIT} onChanged={onChanged} />);

    expect(screen.getByTestId("remaining-claude").textContent).toContain("$8.75");
    expect(screen.getByText(/Anthropic 콘솔이 최종 기준/)).toBeTruthy();
    expect(screen.getByText(/동아리 부담/)).toBeTruthy();
    expect(screen.getByText("첫 구매")).toBeTruthy();
    // No edit or delete for a purchase.
    expect(screen.queryByRole("button", { name: /삭제|수정/ })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "구매 기록 추가" }));
    await user.type(screen.getByLabelText("크레딧 (USD)"), "20");
    await user.type(screen.getByLabelText("실제 결제 (원)"), "28700");
    await user.click(screen.getByRole("button", { name: "기록하기" }));
    expect(accounting.recordPurchase).not.toHaveBeenCalled(); // the confirm dialog first
    const dialogButtons = screen.getAllByRole("button", { name: "기록하기" });
    await user.click(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() =>
      expect(accounting.recordPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "claude", amount_usd: "20.00", paid_krw: 28_700 }),
      ),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  test("음수(정정)는 메모 없이 보낼 수 없다", async () => {
    const { default: CreditPanel } = await import("@/app/admin/budget/CreditPanel");
    render(<CreditPanel credit={CREDIT} onChanged={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "구매 기록 추가" }));
    await user.type(screen.getByLabelText("크레딧 (USD)"), "-1");
    await user.type(screen.getByLabelText("실제 결제 (원)"), "-1400");
    expect(
      (screen.getByRole("button", { name: "기록하기" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.type(screen.getByLabelText("메모"), "첫 구매 정정");
    expect(
      (screen.getByRole("button", { name: "기록하기" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("분기 마감 창", () => {
  test("미리보기와 이월 비율", async () => {
    accounting.getClosePreview.mockImplementation(async (_id: number, percent: number) => ({
      quarter_id: 7, quarter_name: "2026 Q4", carry_over_percent: percent, closed: false,
      reclaimed_krw: 70_000, carry_over_krw: Math.floor((70_000 * percent) / 100), purge_count: 3,
      lines: [
        {
          user_id: 2, username: "yuri", display_name: "김유리", budget_krw: 80_000,
          consumed_krw: 10_000, reclaimed_krw: 70_000,
          carry_over_krw: Math.floor((70_000 * percent) / 100),
        },
      ],
    }));
    accounting.closeQuarter.mockResolvedValue({ quarter_name: "2026 Q4", reclaimed_krw: 70_000, carry_over_krw: 35_000 });
    const onClosed = vi.fn();
    const { default: CloseQuarterDialog } = await import("@/app/admin/quarters/CloseQuarterDialog");
    render(<CloseQuarterDialog quarterId={7} quarterName="2026 Q4" onClose={vi.fn()} onClosed={onClosed} />);

    expect((await screen.findByTestId("close-total")).textContent).toContain("회수 70,000원");
    // 되살리지 않은 삭제 항목은 마감과 함께 사라집니다 — 몇 개인지 미리 말합니다.
    expect(screen.getByTestId("close-purge").textContent).toContain("3개");
    const user = userEvent.setup();
    const percent = screen.getByLabelText("다음 분기로 이월할 비율 (%)");
    await user.clear(percent);
    await user.type(percent, "50");
    await waitFor(() => expect(screen.getByTestId("close-total").textContent).toContain("그중 이월 35,000원"));
    await user.click(screen.getByRole("button", { name: "분기 마감" }));
    await waitFor(() => expect(accounting.closeQuarter).toHaveBeenCalledWith(7, 50));
    expect(onClosed).toHaveBeenCalled();
  });
});
