/**
 * owner-polish 10 — the 띠링 sound: off by default, a Profile › 알림 switch
 * for this device (localStorage), plays on a real charge only when on,
 * never with reduced motion.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const chime = vi.hoisted(() => ({ playChime: vi.fn() }));
vi.mock("@/lib/chime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chime")>();
  return { ...actual, playChime: () => chime.playChime() };
});
vi.mock("@/lib/spend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spend")>()),
  claimMilestone: vi.fn().mockResolvedValue(null),
  setPreferences: vi.fn().mockResolvedValue({ spend_notifications: true }),
}));
vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({
    state: { phase: "authenticated", user: { id: 1, spend_notifications: true } },
    refresh: vi.fn(),
  }),
}));
vi.mock("@/app/components/MyQuarterProvider", () => ({ useMyQuarter: () => ({ state: { phase: "loading" } }) }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    useReducedMotion: () => motion.reduced,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { default: SpendFeedbackProvider, useSpendFeedback } = await import("@/app/components/SpendFeedbackProvider");
const { NotificationSettings } = await import("@/app/profile/AccountIdentity");
const { forgetSoundPrefInMemory } = await import("@/lib/chime");

type Report = Parameters<ReturnType<typeof useSpendFeedback>["reportCharge"]>[0];
const handle: { report: (r: Report) => void } = { report: () => {} };
function Probe() {
  const api = useSpendFeedback();
  useEffect(() => {
    handle.report = api.reportCharge;
  });
  return null;
}

function setup() {
  render(
    <SpendFeedbackProvider>
      <NotificationSettings />
      <Probe />
    </SpendFeedbackProvider>,
  );
}

beforeEach(() => {
  chime.playChime.mockReset();
  window.localStorage.clear();
  forgetSoundPrefInMemory();
  motion.reduced = false;
});
afterEach(() => forgetSoundPrefInMemory());

describe("띠링 소리", () => {
  test("기본은 꺼짐: 차감이 와도 소리가 없다", () => {
    setup();
    expect(screen.getByTestId("spend-sound-toggle")).toHaveProperty("checked", false);
    act(() => handle.report({ chargedKrw: 12 }));
    expect(chime.playChime).not.toHaveBeenCalled();
  });

  test("켜면 바로 한 번, 그 뒤 진짜 차감마다; 이 기기에 남는다", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("spend-sound-toggle"));
    expect(screen.getByTestId("spend-sound-toggle")).toHaveProperty("checked", true);
    expect(chime.playChime).toHaveBeenCalledTimes(1); // the preview
    expect(window.localStorage.getItem("ctrlai.spend-sound")).toBe("1");

    act(() => handle.report({ chargedKrw: 12 }));
    expect(chime.playChime).toHaveBeenCalledTimes(2);
    // 0원 — nothing was charged, so no sound either.
    act(() => handle.report({ chargedKrw: 0 }));
    expect(chime.playChime).toHaveBeenCalledTimes(2);
  });

  test("움직임 줄이기면 켜 두어도 소리는 나지 않는다", async () => {
    motion.reduced = true;
    window.localStorage.setItem("ctrlai.spend-sound", "1");
    setup();
    act(() => handle.report({ chargedKrw: 12 }));
    expect(chime.playChime).not.toHaveBeenCalled();
  });
});
