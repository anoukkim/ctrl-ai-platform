/**
 * motion-modern — the owner's "더 현대적인 느낌" (2026-10-16).
 *
 * (1) The aurora card names its steps from what has arrived; (5) 게시 완료
 * pops its letters and leaves on its own, and under 움직임 줄이기 shows
 * only the text; nothing waits on a click.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    // A script without any style still finishes the style step.
    expect(chipsFromCode("<html><body><script>x()</script>").map((c) => c.state)).toEqual(["done", "done", "now"]);
  });

  test("제목, 초, 비용, 칩이 보이고 상태로 읽힌다", () => {
    vi.useFakeTimers();
    render(<AuroraCard since={Date.now() - 5000} costKrw={30} chips={chipsFromCode("<html><body>")} />);
    const card = screen.getByTestId("aurora-card");
    expect(card.textContent).toContain("미리보기 만드는 중…");
    expect(card.textContent).toContain("5초");
    expect(card.textContent).toContain("약 30원");
    expect(card.querySelectorAll("li").length).toBe(3);
    vi.useRealTimers();
  });
});

describe("게시 완료 — 팝업 카드 (publish-done-popup A, replacing (5))", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    motion.reduced = false;
  });

  const URL = "http://apps.test/k3m9qx7pwa/";

  test("체크 둘레에만 색종이, 게시했어요 + 앱 이름, 열어 보기 / 링크 복사; 6초 뒤 스스로 사라진다", async () => {
    const onDone = vi.fn();
    render(<PublishCelebration name="오늘 할 일" url={URL} onDone={onDone} />);
    const card = screen.getByTestId("publish-celebration");
    expect(card.textContent).toContain("게시했어요");
    expect(card.textContent).toContain("오늘 할 일 · CtrlAIApps");
    // A few pieces, all inside the check — no full-screen layer.
    const pieces = card.querySelectorAll("[class*='confetti']");
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.length).toBeLessThanOrEqual(8);
    pieces.forEach((piece) => expect(piece.parentElement?.className).toMatch(/check/));
    const css = readFileSync(resolve(__dirname, "../app/components/celebration.module.css"), "utf8");
    expect(css).not.toMatch(/inset:\s*0/);
    expect(css).toMatch(/\.card\s*\{[^}]*bottom:\s*9\.5rem/);
    const open = screen.getByRole("link", { name: /열어 보기/ });
    expect(open.getAttribute("href")).toBe(URL);
    expect(open.getAttribute("rel")).toContain("noopener");
    // Never takes focus; announced once.
    expect(document.activeElement).toBe(document.body);
    expect(screen.getAllByRole("status").map((node) => node.textContent)).toEqual(["게시했어요"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CELEBRATION_MS - 100);
    });
    expect(screen.queryByTestId("publish-celebration")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByTestId("publish-celebration")).toBeNull();
    expect(onDone).toHaveBeenCalled();
  });

  test("링크 복사는 주소를 복사하고, ✕로 바로 닫힌다; 손이 올라가 있으면 기다린다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PublishCelebration name="오늘 할 일" url={URL} onDone={() => {}} />);
    const card = screen.getByTestId("publish-celebration");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /링크 복사/ }));
    });
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(card.textContent).toContain("복사했어요");
    fireEvent.pointerEnter(card);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CELEBRATION_MS + 500);
    });
    expect(screen.queryByTestId("publish-celebration")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByTestId("publish-celebration")).toBeNull();
  });

  test("움직임 줄이기면 색종이 없이 카드만", () => {
    motion.reduced = true;
    render(<PublishCelebration name="오늘 할 일" url={null} onDone={() => {}} />);
    const card = screen.getByTestId("publish-celebration");
    expect(card.textContent).toContain("게시했어요");
    expect(card.querySelectorAll("[class*='confetti']").length).toBe(0);
    // No address yet: no buttons that lead nowhere.
    expect(screen.queryByRole("link", { name: /열어 보기/ })).toBeNull();
  });
});
