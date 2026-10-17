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
import { useEffect } from "react";
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

const chime = vi.hoisted(() => ({ playChime: vi.fn() }));
vi.mock("@/lib/chime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chime")>();
  return { ...actual, playChime: () => chime.playChime() };
});

const { TOAST_MS } = await import("@/lib/spend");
const { default: SpendFeedbackProvider, useSpendFeedback, toastMainText, pillText, placePill } = await import(
  "@/app/components/SpendFeedbackProvider"
);

type Report = Parameters<ReturnType<typeof useSpendFeedback>["reportCharge"]>[0];
const handle: { report: (r: Report) => void } = { report: () => {} };
const report = (r: Report) => handle.report(r);

function Probe() {
  const api = useSpendFeedback();
  useEffect(() => {
    handle.report = api.reportCharge;
  });
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
  chime.playChime.mockReset();
  window.localStorage.clear();
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

  test("진짜 차감이면 한 줄 알약, -N원, 장부의 남은 지원금 (spend-toast-compact)", async () => {
    setup();
    act(() => report({ chargedKrw: 12, label: "채팅 · Sonnet" }));
    // One line: the amount, then (once known) what is left. What it was for
    // is in the tooltip and the screen-reader line, not on the pill.
    expect(screen.getByTestId("spend-toast").textContent).toBe("−12원");
    expect(screen.getByTestId("spend-toast").getAttribute("title")).toContain("채팅 · Sonnet");
    expect(screen.getByTestId("spend-live").textContent).toContain("채팅 · Sonnet");
    expect(screen.getByTestId("chip").textContent).toBe("-12");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await flush();
    expect(spendApi.claimMilestone).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("spend-toast").textContent).toBe("−12원 · 79,988원 남음");
    expect(screen.getByTestId("spend-live").textContent).toContain("12원을 사용했어요!");

    // 2초 뒤 사라집니다 (was 3): still there at 1.9 s, gone by 2.1 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_450);
    });
    expect(screen.getByTestId("spend-toast")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.queryByTestId("spend-toast")).toBeNull();
  });

  test("누르면 Usage로 간다", async () => {
    setup();
    act(() => report({ chargedKrw: 15 }));
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
    expect(text).toBe("−36원 (2번) · 79,988원 남음");
    expect(screen.getByTestId("spend-toast").getAttribute("title")).toContain("채팅 · Sonnet · 영상 생성");
    expect(screen.getAllByTestId("spend-toast")).toHaveLength(1);
  });

  test("3초가 지나면 새 알림", async () => {
    setup();
    act(() => report({ chargedKrw: 12 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_200);
    });
    act(() => report({ chargedKrw: 17 }));
    expect(screen.getByTestId("spend-amount").textContent).toBe("−17원");
    expect(screen.getByTestId("spend-toast").textContent).not.toContain("번");
  });

  test("10원 아래는 소리도 없다 (띠링을 켜 두었어도)", () => {
    window.localStorage.setItem("ctrlai.spend-sound", "1");
    setup();
    act(() => report({ chargedKrw: 4 }));
    expect(chime.playChime).not.toHaveBeenCalled();
    // …and the same setting does chime once the charge is heard (the test is not vacuous).
    act(() => report({ chargedKrw: 12 }));
    expect(chime.playChime).toHaveBeenCalledTimes(1);
  });

  test("10원 아래는 조용히: 알약 없이 잔액만 (합쳐서 10원이 넘으면 그때 보여요)", async () => {
    setup();
    act(() => report({ chargedKrw: 4 }));
    expect(screen.queryByTestId("spend-toast")).toBeNull();
    expect(screen.getByTestId("chip").textContent).toBe("-4");
    act(() => report({ chargedKrw: 7 }));
    expect(screen.getByTestId("spend-toast").textContent).toContain("−11원 (2번)");
  });

  test("알약 문구", () => {
    expect(pillText({ count: 1, totalKrw: 156, remainingKrw: 68_336 })).toBe("−156원 · 68,336원 남음");
    expect(pillText({ count: 3, totalKrw: 36, remainingKrw: 68_336 })).toBe("−36원 (3번) · 68,336원 남음");
    expect(pillText({ count: 1, totalKrw: 12, remainingKrw: null })).toBe("−12원");
    expect(TOAST_MS).toBe(2000);
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

  test("별은 잔액에서만 반짝인다 — 알림에서 날아가는 것은 없다 (spend-toast-compact)", () => {
    setup();
    const balance = document.createElement("span");
    balance.dataset.walletBalance = "true";
    balance.getBoundingClientRect = () =>
      ({ left: 20, top: 500, width: 80, height: 20, right: 100, bottom: 520 }) as DOMRect;
    document.body.appendChild(balance);

    act(() => report({ chargedKrw: 12, label: "채팅 · Sonnet" }));
    expect(screen.queryByTestId("spend-fly")).toBeNull();
    const twinkle = screen.getByTestId("spend-twinkle");
    expect(twinkle.getAttribute("data-stars")).toBe("4");
    // Every star sits around the wallet's centre (60, 510), none at the toast.
    for (const star of twinkle.querySelectorAll<HTMLElement>("span")) {
      expect(Math.abs(parseFloat(star.style.left) - 60)).toBeLessThan(60);
      expect(Math.abs(parseFloat(star.style.top) - 510)).toBeLessThan(60);
    }
    expect(screen.getByTestId("spend-toast").querySelector("svg")).toBeNull(); // no coin
    expect(chime.playChime).not.toHaveBeenCalled();
    balance.remove();
  });

  test("잔액이 안 보이면 반짝임도 없고 알약만", () => {
    setup();
    act(() => report({ chargedKrw: 17 }));
    expect(screen.queryByTestId("spend-twinkle")).toBeNull();
    expect(screen.getByTestId("spend-amount").textContent).toBe("−17원");
  });

  test("움직임 줄이기면 반짝임 없이 알약만", () => {
    motion.reduced = true;
    setup();
    const balance = document.createElement("span");
    balance.dataset.walletBalance = "true";
    balance.getBoundingClientRect = () =>
      ({ left: 20, top: 500, width: 80, height: 20, right: 100, bottom: 520 }) as DOMRect;
    document.body.appendChild(balance);
    act(() => report({ chargedKrw: 12 }));
    expect(screen.queryByTestId("spend-twinkle")).toBeNull();
    expect(screen.getByTestId("spend-toast")).toBeTruthy();
    balance.remove();
  });

  test("알림은 초점을 가져가지 않는다", () => {
    setup();
    const before = document.activeElement;
    act(() => report({ chargedKrw: 12 }));
    expect(document.activeElement).toBe(before);
    expect(screen.getByTestId("spend-toast").getAttribute("tabindex")).toBe("-1");
  });
});

describe("where the pill appears (owner, 2026-10-17)", () => {
  test("just above the 「남은 지원금」 line when one is in view, else the CSS default", () => {
    const pill = document.createElement("button");
    placePill(pill);
    expect(pill.style.bottom).toBe("");

    const anchor = document.createElement("span");
    anchor.setAttribute("data-spend-anchor", "");
    anchor.getBoundingClientRect = () =>
      ({ left: 420, top: 700, right: 560, bottom: 718, width: 140, height: 18, x: 420, y: 700, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(anchor);
    placePill(pill);
    expect(pill.style.left).toBe("420px");
    expect(pill.style.bottom).toBe(`${window.innerHeight - 700 + 6}px`);
    anchor.remove();
  });
});
