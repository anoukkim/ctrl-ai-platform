/**
 * feat-spend-feedback (주인 추가 B, 2026-10-14) — "썼어요" 알림.
 *
 * 증명하는 것:
 *   - 진짜 차감(장부의 charged_krw > 0)에서만 알림과 "-N원"이 나온다.
 *   - 3초 안에 온 차감은 알림 하나로 합친다("2번 · 합계 …").
 *   - 남은 지원금은 백엔드의 이정표 응답에서 온 값으로 바로잡힌다.
 *   - 백엔드가 돌려준 이정표만 카드로 보인다(분기당 한 번은 백엔드가 지킨다).
 *   - 알림을 끄면 아무것도 나오지 않는다.
 *   - 움직임 줄이기면 "-N원"은 없고 알림만 나온다.
 *   - 화면 낭독기에는 polite 한 줄.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const spendApi = vi.hoisted(() => ({ claimMilestone: vi.fn(), setPreferences: vi.fn() }));
vi.mock("@/lib/spend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spend")>();
  return {
    ...actual,
    claimMilestone: (...args: unknown[]) => spendApi.claimMilestone(...args),
    setPreferences: (...args: unknown[]) => spendApi.setPreferences(...args),
  };
});

const user = vi.hoisted(() => ({ spend_notifications: true as boolean | undefined }));
vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({
    state: { phase: "authenticated", user: { id: 1, spend_notifications: user.spend_notifications } },
    refresh: vi.fn(),
  }),
}));

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  // Exit animations never finish under fake timers; render the end state.
  return {
    ...actual,
    useReducedMotion: () => motion.reduced,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { default: SpendFeedbackProvider, useSpendFeedback, toastMainText } = await import(
  "@/app/components/SpendFeedbackProvider"
);

type Report = Parameters<ReturnType<typeof useSpendFeedback>["reportCharge"]>[0];
let report: (r: Report) => void = () => {};

function Probe() {
  const api = useSpendFeedback();
  report = api.reportCharge;
  return <span data-testid="chip">{api.lastSpend ? `-${api.lastSpend.amountKrw}` : ""}</span>;
}

function setup() {
  render(
    <SpendFeedbackProvider>
      <Probe />
    </SpendFeedbackProvider>,
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  spendApi.claimMilestone.mockReset();
  spendApi.claimMilestone.mockResolvedValue({
    milestone: null, budget_krw: 80_000, consumed_krw: 12, remaining_krw: 79_988, percent_used: 0,
  });
  user.spend_notifications = true;
  motion.reduced = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("차감이 있을 때만", () => {
  test("0원·없음이면 아무것도 나오지 않는다", async () => {
    setup();
    act(() => report({ chargedKrw: 0 }));
    act(() => report({ chargedKrw: null }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByTestId("spend-toast")).toBeNull();
    expect(screen.getByTestId("chip").textContent).toBe("");
    expect(spendApi.claimMilestone).not.toHaveBeenCalled();
  });

  test("진짜 차감이면 알림, -N원, 장부의 남은 지원금", async () => {
    setup();
    act(() => report({ chargedKrw: 12, label: "채팅 · Sonnet" }));
    expect(screen.getByTestId("spend-toast").textContent).toContain("12원을 사용했어요!");
    expect(screen.getByTestId("spend-toast").textContent).toContain("채팅 · Sonnet");
    expect(screen.getByTestId("chip").textContent).toBe("-12");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await flush();
    expect(spendApi.claimMilestone).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("spend-toast").textContent).toContain("남은 지원금 79,988원");
    expect(screen.getByTestId("spend-live").textContent).toContain("12원을 사용했어요!");

    // 3초 뒤 사라집니다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(screen.queryByTestId("spend-toast")).toBeNull();
  });

  test("누르면 Usage로 간다", async () => {
    setup();
    act(() => report({ chargedKrw: 5 }));
    act(() => screen.getByTestId("spend-toast").click());
    expect(push).toHaveBeenCalledWith("/usage");
  });
});

describe("3초 안의 차감은 하나로", () => {
  test("합쳐서 '2번 · 합계'", async () => {
    setup();
    act(() => report({ chargedKrw: 12, label: "채팅 · Sonnet" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => report({ chargedKrw: 24, label: "영상 생성" }));
    const text = screen.getByTestId("spend-toast").textContent ?? "";
    expect(text).toContain("2번 · 합계 36원을 사용했어요!");
    expect(text).toContain("채팅 · Sonnet · 영상 생성");
    expect(screen.getAllByTestId("spend-toast")).toHaveLength(1);
  });

  test("3초가 지나면 새 알림", async () => {
    setup();
    act(() => report({ chargedKrw: 12 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_200);
    });
    act(() => report({ chargedKrw: 7 }));
    expect(screen.getByTestId("spend-toast").textContent).toContain("7원을 사용했어요!");
    expect(screen.getByTestId("spend-toast").textContent).not.toContain("2번");
  });

  test("문구", () => {
    expect(toastMainText({ count: 1, totalKrw: 12, remainingKrw: 79_988 })).toBe(
      "12원을 사용했어요! 남은 지원금 79,988원",
    );
    expect(toastMainText({ count: 3, totalKrw: 36, remainingKrw: null })).toBe(
      "3번 · 합계 36원을 사용했어요!",
    );
  });
});

describe("이정표", () => {
  test("백엔드가 돌려준 이정표만 카드로 — 50%", async () => {
    spendApi.claimMilestone.mockResolvedValue({
      milestone: "used_50", budget_krw: 80_000, consumed_krw: 48_000, remaining_krw: 32_000, percent_used: 60,
    });
    setup();
    act(() => report({ chargedKrw: 30_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await flush();
    const card = screen.getByTestId("spend-milestone");
    expect(card.getAttribute("data-kind")).toBe("used_50");
    expect(card.textContent).toContain("지원금의 절반을 썼어요");
    expect(card.textContent).toContain("남은 지원금 32,000원");
    expect(card.textContent).toContain("60%");
  });

  test("첫 사용은 축하, 잔액 10,000원 이하는 차분한 경고와 Usage 링크", async () => {
    spendApi.claimMilestone.mockResolvedValueOnce({
      milestone: "first", budget_krw: 80_000, consumed_krw: 5, remaining_krw: 79_995, percent_used: 0,
    });
    setup();
    act(() => report({ chargedKrw: 5 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await flush();
    expect(screen.getByTestId("spend-milestone").textContent).toContain("첫 작품을 시작했어요 🎉");

    spendApi.claimMilestone.mockResolvedValueOnce({
      milestone: "low", budget_krw: 80_000, consumed_krw: 71_000, remaining_krw: 9_000, percent_used: 88,
    });
    act(() => report({ chargedKrw: 70_995 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await flush();
    const card = screen.getByTestId("spend-milestone");
    expect(card.getAttribute("data-kind")).toBe("low");
    expect(card.textContent).toContain("Usage에서 보기");
  });

  test("이정표가 없으면 카드도 없다", async () => {
    setup();
    act(() => report({ chargedKrw: 3 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await flush();
    expect(screen.queryByTestId("spend-milestone")).toBeNull();
  });
});

describe("설정", () => {
  test("사용 알림 표시를 끄면 아무것도 나오지 않는다", async () => {
    user.spend_notifications = false;
    setup();
    act(() => report({ chargedKrw: 12 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByTestId("spend-toast")).toBeNull();
    expect(screen.getByTestId("chip").textContent).toBe("");
    expect(spendApi.claimMilestone).not.toHaveBeenCalled();
  });

  test("움직임 줄이기면 -N원 없이 알림만", () => {
    motion.reduced = true;
    setup();
    act(() => report({ chargedKrw: 12 }));
    expect(screen.getByTestId("spend-toast")).toBeTruthy();
    expect(screen.getByTestId("chip").textContent).toBe("");
  });

  test("알림은 초점을 가져가지 않는다", () => {
    setup();
    const before = document.activeElement;
    act(() => report({ chargedKrw: 12 }));
    expect(document.activeElement).toBe(before);
    expect(screen.getByTestId("spend-toast").getAttribute("tabindex")).toBe("-1");
  });
});
