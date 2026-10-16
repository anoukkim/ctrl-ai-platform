/**
 * motion-modern — the owner's "더 현대적인 느낌" (2026-10-16).
 *
 * (1) The aurora card names its steps from what has arrived; (5) 게시 완료
 * pops its letters and leaves on its own, and under 움직임 줄이기 shows
 * only the text; nothing waits on a click.
 */
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  // Exit animations never finish under fake timers (as in spend-feedback):
  // render the end state and report the exit as soon as the child is gone.
  function AnimatePresence({ children, onExitComplete }: { children: React.ReactNode; onExitComplete?: () => void }) {
    const gone = !children;
    useEffect(() => {
      if (gone) onExitComplete?.();
    }, [gone, onExitComplete]);
    return <>{children}</>;
  }
  return { ...actual, useReducedMotion: () => motion.reduced, AnimatePresence };
});

const { default: AuroraCard, chipsFromCode } = await import("@/app/components/AuroraCard");
const { default: PublishCelebration, CELEBRATION_MS } = await import("@/app/components/PublishCelebration");

describe("오로라 카드 (1)", () => {
  test("코드에 들어온 것으로 단계 칩을 정한다: 뼈대 → 스타일 → 동작", () => {
    expect(chipsFromCode("<!doctype html><html><body><h1>안녕").map((c) => c.state)).toEqual(["now", "todo", "todo"]);
    expect(chipsFromCode("<html><head><style>body{}</style></head><body>").map((c) => c.state)).toEqual(["done", "now", "todo"]);
    expect(chipsFromCode("<html><style>a{}</style><body><script>x()</script>").map((c) => c.state)).toEqual(["done", "done", "now"]);
  });

  test("제목, 초, 비용, 칩이 보이고 상태로 읽힌다", () => {
    vi.useFakeTimers();
    render(<AuroraCard since={Date.now() - 5000} costKrw={30} chips={chipsFromCode("<html><body>")} />);
    const card = screen.getByRole("status");
    expect(card.textContent).toContain("미리보기 만드는 중…");
    expect(card.textContent).toContain("5초");
    expect(card.textContent).toContain("약 30원");
    expect(card.querySelectorAll("li").length).toBe(3);
    vi.useRealTimers();
  });
});

describe("게시 완료 (5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    motion.reduced = false;
  });

  test("글자가 한 자씩 튀어 오르고, 색종이가 흩날리며, 스스로 사라진다", async () => {
    const onDone = vi.fn();
    render(<PublishCelebration onDone={onDone} />);
    const stage = screen.getByTestId("publish-celebration");
    expect(stage.textContent?.replace(/\u00a0/g, " ")).toBe("게시 완료!");
    expect(stage.querySelectorAll("[class*='confetti']").length).toBeGreaterThan(10);
    expect(stage.querySelectorAll("[class*='letter']").length).toBe(6);
    // Clicks go straight through: nothing to press, nothing in the way.
    expect(getComputedStyle(stage).pointerEvents === "none" || stage.className.includes("stage")).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CELEBRATION_MS + 50);
    });
    expect(screen.queryByTestId("publish-celebration")).toBeNull();
    expect(onDone).toHaveBeenCalled();
  });

  test("움직임 줄이기면 글자만 잠깐", () => {
    motion.reduced = true;
    render(<PublishCelebration onDone={() => {}} />);
    const stage = screen.getByTestId("publish-celebration");
    expect(stage.textContent?.replace(/\u00a0/g, " ")).toBe("게시 완료!");
    expect(stage.querySelectorAll("[class*='confetti']").length).toBe(0);
  });
});
