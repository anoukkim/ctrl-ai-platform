/**
 * owner-polish 14 — "생각하고 있다는 UI".
 *
 * Builder: the plan card's current step spins and counts seconds, finished
 * steps tick with a pop, a thin n / m bar fills; the working button is busy
 * (cursor: progress), never disabled (🚫). Chat: before the first words,
 * "생각하는 중…" shimmers with the seconds beside it.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Generation } from "@/lib/generation";

const { PlanCard, NO_PROGRESS } = await import("@/app/builder/[projectId]/StagedGeneration");
const { default: WorkingSince, elapsedSeconds } = await import("@/app/components/WorkingSince");

const PLAN: Generation = {
  id: 3,
  kind: "edit",
  request: "다크 모드",
  style: "",
  summary: "파일 두 개를 고쳐요.",
  plan: [
    { path: "index.html", purpose: "화면의 뼈대" },
    { path: "app.js", purpose: "저장 동작" },
  ],
  files_done: [],
  status: "planned",
  check_summary: "",
  check_fixed: [],
  charged_krw: 3,
  error: "",
  version_number: null,
  created_at: "2026-10-16T00:00:00Z",
  estimated_krw: 40,
  max_call_krw: 200,
};

describe("Builder 계획 카드 — 일하는 중", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("쓰는 파일은 돌고 초를 세고, 끝난 파일은 ✓, 막대는 n / m 파일", () => {
    const { rerender } = render(
      <PlanCard
        generation={PLAN}
        running
        progress={{ ...NO_PROGRESS, current: "index.html" }}
        disabled={false}
        onStart={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByTestId("plan-progress").textContent).toContain("0 / 2 파일");
    const writing = screen.getByText("index.html").closest("li")!;
    expect(writing.dataset.state).toBe("writing");
    expect(writing.querySelector("svg.lucide-loader-circle, svg.lucide-loader-2")).toBeTruthy();
    expect(writing.textContent).toContain("작성 중…");
    expect(screen.getByTestId("working-since").textContent).toBe("0초");

    act(() => vi.advanceTimersByTime(3_100));
    expect(screen.getByTestId("working-since").textContent).toBe("3초");

    // index.html done, app.js starts: ✓ pops in, the timer starts over.
    rerender(
      <PlanCard
        generation={PLAN}
        running
        progress={{ ...NO_PROGRESS, current: "app.js", charged: { "index.html": 20 } }}
        disabled={false}
        onStart={() => {}}
        onCancel={() => {}}
      />,
    );
    const done = screen.getByText("index.html").closest("li")!;
    expect(done.dataset.state).toBe("done");
    expect(done.querySelector("svg.success-pop")).toBeTruthy();
    expect(screen.getByTestId("plan-progress").textContent).toContain("1 / 2 파일");
    expect(screen.getByText("app.js").closest("li")!.dataset.state).toBe("writing");
    // The action buttons stay hidden while running.
    expect(screen.queryByRole("button", { name: /시작|이어서 만들기/ })).toBeNull();
  });

  test("초 세기는 시작 시각부터, 음수 없이", () => {
    expect(elapsedSeconds(10_000, 13_999)).toBe(3);
    expect(elapsedSeconds(10_000, 9_000)).toBe(0);
    render(<WorkingSince since={Date.now()} />);
    expect(screen.getByTestId("working-since").textContent).toBe("0초");
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByTestId("working-since").textContent).toBe("2초");
  });
});

describe("일하는 중인 단추는 🚫가 아니다", () => {
  test("btn-working은 progress 커서, disabled 단추만 not-allowed", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    const working = css.slice(css.indexOf(".btn-working"), css.indexOf(".btn-working") + 200);
    expect(working).toContain("cursor: progress");
    expect(css).toContain(".btn:disabled");
    const stepCss = readFileSync(resolve(__dirname, "../app/builder/[projectId]/staged.module.css"), "utf8");
    expect(stepCss).toContain(".progressFill");
  });
});

describe("motion-modern (3) — 접힌 단계", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("돌아가는 동안 끝난 파일은 '✓ N개 완료'로 접히고(펼칠 수 있음), 남은 파일은 점, 지금 파일만 크다", () => {
    render(
      <PlanCard
        generation={{ ...PLAN, plan: [...PLAN.plan, { path: "style.css", purpose: "모양" }] }}
        running
        progress={{ ...NO_PROGRESS, current: "app.js", charged: { "index.html": 20 } }}
        disabled={false}
        onStart={() => {}}
        onCancel={() => {}}
      />,
    );
    const fold = screen.getByTestId("done-fold");
    expect(fold.textContent).toContain("1개 완료");
    // The finished row is folded away until asked for.
    const done = screen.getByText("index.html").closest("li")!;
    expect(done.hidden).toBe(true);
    fireEvent.click(within(fold).getByRole("button", { name: /1개 완료/ }));
    expect(done.hidden).toBe(false);
    // The file being written is the big one; the rest are dots.
    expect(screen.getByText("app.js").closest("li")!.className).toContain("stepNow");
    const dots = screen.getByTestId("waiting-dots");
    expect(dots.querySelectorAll("[title]").length).toBe(1);
    expect(dots.textContent).toContain("남은 파일 1개");
    expect(screen.queryByText("style.css")).toBeNull();
  });

  test("끝난 뒤에는 모든 줄이 그대로 보인다", () => {
    render(
      <PlanCard
        generation={{ ...PLAN, files_done: ["index.html", "app.js"] }}
        running={false}
        progress={NO_PROGRESS}
        disabled={false}
        onStart={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("done-fold")).toBeNull();
    expect(screen.queryByTestId("waiting-dots")).toBeNull();
    expect(screen.getByText("index.html").closest("li")!.hidden).toBe(false);
  });
});
