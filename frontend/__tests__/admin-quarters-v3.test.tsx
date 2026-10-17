/**
 * admin-consolidation v3 (2) — Quarters › 분기 · 예산: the 분기 마감 steps
 * follow the quarters themselves, and 돈의 흐름's bar adds up.
 */
import { describe, expect, test } from "vitest";

import { stepsDone } from "@/app/admin/quarters/CloseStepper";
import { flowShares } from "@/app/admin/quarters/MoneyFlowCard";
import type { Quarter } from "@/lib/quarters";

const Q4: Quarter = {
  id: 4,
  code: "2026-Q4",
  display_name: "2026 Q4",
  starts_at: "2026-10-01",
  ends_at: "2026-12-31",
  application_opens_at: null,
  application_closes_at: "2026-10-31",
  status: "application_open",
  subsidy_limit_krw: 80_000,
};

describe("분기 마감 단계", () => {
  test("신청 중이면 1단계부터; 진행 중이면 2단계; 마감되면 2·3단계가 함께 끝", () => {
    expect(stepsDone(Q4, [Q4], false)).toEqual([false, false, false, false, false]);
    expect(stepsDone({ ...Q4, status: "active" }, [Q4], false)).toEqual([true, false, false, false, false]);
    expect(stepsDone({ ...Q4, status: "closed" }, [Q4], false)).toEqual([true, true, true, false, false]);
  });

  test("앱 보관은 확인으로, 다음 분기는 그 뒤에 신청을 연 분기가 있을 때", () => {
    const closed = { ...Q4, status: "closed" as const };
    expect(stepsDone(closed, [closed], true)).toEqual([true, true, true, true, false]);
    const next: Quarter = { ...Q4, id: 5, starts_at: "2027-01-01", ends_at: "2027-03-31", status: "application_open" };
    expect(stepsDone(closed, [closed, next], false)).toEqual([true, true, true, true, true]);
    // A draft of the next quarter is not "opened" yet.
    expect(stepsDone(closed, [closed, { ...next, status: "draft" }], false)[4]).toBe(false);
  });
});

test("돈의 흐름 막대: 쓴 돈 · 안 쓴 돈 · 여유분이 산 크레딧을 나눈다", () => {
  const flow = {
    purchased_krw: 1_200_000,
    granted_krw: 880_000,
    members: 11,
    used_krw: 96_410,
    unused_krw: 783_590,
    reserve_krw: 320_000,
    reserve_spent_krw: 4_200,
    forecast_used_krw: 412_000,
    days_left: 75,
  };
  expect(flowShares(flow)).toEqual({ used: 8, unused: 65, reserve: 27 });
  // More handed out than bought: the bar is the wallets, no reserve.
  expect(flowShares({ ...flow, purchased_krw: 500_000, reserve_krw: -380_000 })).toEqual({ used: 11, unused: 89, reserve: 0 });
});
