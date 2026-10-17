/**
 * running-state-calm — one calm "running" signal for Chat and the Builder.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import AuroraCard from "@/app/components/AuroraCard";
import BuilderRunPanel, { STAGES, tailOf } from "@/app/builder/[projectId]/BuilderRunPanel";
import { AURORA_KEY, setAurora } from "@/lib/aurora";
import { finishRun, isRunning, resetRuns, startRun, useRuns } from "@/lib/running";

function Probe() {
  const runs = useRuns();
  return <span data-testid="probe">{runs.map((run) => `${run.kind}:${run.id}`).join(",")}</span>;
}

describe("the running store survives navigation", () => {
  beforeEach(() => {
    resetRuns();
    window.localStorage.removeItem(AURORA_KEY);
  });

  test("start and finish are seen by every subscriber (one store for the tab, kept across screens)", () => {
    render(<Probe />);
    act(() => startRun("builder", 7));
    expect(screen.getByTestId("probe").textContent).toBe("builder:7");
    act(() => startRun("chat", 3));
    expect(screen.getByTestId("probe").textContent).toBe("builder:7,chat:3");
    act(() => finishRun("builder", 7));
    expect(screen.getByTestId("probe").textContent).toBe("chat:3");
  });

  test("nothing is kept for a reload: a fresh page knows of no run (no ghost dot)", async () => {
    act(() => startRun("builder", 9));
    vi.resetModules();
    const fresh = await import("@/lib/running");
    function FreshProbe() {
      const runs = fresh.useRuns();
      return <span data-testid="fresh">{runs.length}</span>;
    }
    render(<FreshProbe />);
    expect(screen.getByTestId("fresh").textContent).toBe("0");
    expect(isRunning([], "builder")).toBe(false);
  });
});

describe("Builder run panel — real stages, big words", () => {
  test("stage text and timer are large; stages, file chips and the code tail follow the events", () => {
    render(
      <BuilderRunPanel
        stage={1}
        since={Date.now() - 63_000}
        files={[
          { path: "index.html", state: "done" },
          { path: "style.css", state: "writing" },
          { path: "app.js", state: "waiting" },
        ]}
        tail={{ path: "index.html", lines: tailOf("a\nb\nc\nd\ne\nf\ng\nh\ni\n") }}
        costKrw={56}
      />,
    );
    expect(screen.getByTestId("run-stage").textContent).toBe("파일 쓰기 중…");
    expect(screen.getByTestId("working-since").textContent).toBe("63초");
    const stages = screen.getByRole("list", { name: "단계" }).querySelectorAll("li");
    expect([...stages].map((li) => li.getAttribute("data-state"))).toEqual(["done", "now", "todo"]);
    expect(STAGES).toEqual(["요구사항 읽기", "파일 쓰기", "미리보기 조립"]);
    const files = screen.getByRole("list", { name: "파일" }).textContent ?? "";
    expect(files).toContain("index.html · 완료");
    expect(files).toContain("style.css · 쓰는 중");
    // The last seven lines of the file, nothing invented.
    expect(screen.getByTestId("run-tail").textContent).toBe("c\nd\ne\nf\ng\nh\ni");
    expect(screen.getByText(/지금까지 약 56원/)).toBeTruthy();
  });

  test("no percentage anywhere — where there is no event, only the sweep and the time", () => {
    const { container } = render(<BuilderRunPanel stage={0} since={Date.now()} files={[]} tail={null} costKrw={null} />);
    expect(container.textContent).not.toMatch(/%/);
    expect(container.querySelector(".run-sweep")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "파일" })).toBeNull();
  });
});

describe("오로라 배경 — small and optional", () => {
  beforeEach(() => window.localStorage.removeItem(AURORA_KEY));

  test("on by default inside the card; the Profile switch turns it off on this device", () => {
    render(<AuroraCard since={Date.now()} chips={[]} />);
    expect(screen.getByTestId("aurora-glow")).toBeTruthy();
    act(() => setAurora(false));
    expect(screen.queryByTestId("aurora-glow")).toBeNull();
    expect(window.localStorage.getItem(AURORA_KEY)).toBe("0");
    // The card itself keeps its sweep and words without it.
    expect(screen.getByTestId("aurora-card").querySelector(".run-sweep")).toBeTruthy();
  });
});
