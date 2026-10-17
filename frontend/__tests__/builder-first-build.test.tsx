/**
 * builder-first-build-running — a first build looks like every other build.
 *
 * The approved 만들 계획 stays; above it the same stages, big timer, top
 * sweep and (optional) aurora as the preview's run panel — one header, two
 * hosts — and the plan's `n / m 파일` bar folds into that header.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FirstBuildRun, STAGES } from "@/app/builder/[projectId]/BuilderRunPanel";
import { NO_PROGRESS, PlanCard } from "@/app/builder/[projectId]/StagedGeneration";
import type { Generation } from "@/lib/generation";

const PLAN: Generation = {
  id: 4,
  kind: "create",
  request: "영화 연결 지도",
  style: "",
  summary: "영화 제목을 검색해 연결 지도를 그려 주는 앱입니다.",
  plan: [
    { path: "index.html", purpose: "화면의 뼈대" },
    { path: "style.css", purpose: "색과 배치" },
    { path: "app.js", purpose: "검색과 지도" },
  ],
  files_done: ["index.html"],
  status: "running",
  check_summary: "",
  check_fixed: [],
  charged_krw: 3,
  error: "",
  version_number: null,
  created_at: "2026-10-17T00:00:00Z",
  estimated_krw: 75,
  max_call_krw: 235,
};

describe("처음 만들 때도 같은 진행 화면", () => {
  test("단계·큰 타이머·위쪽 선이 계획 위에, n / m 파일은 머리 줄에 한 번만", () => {
    render(
      <FirstBuildRun stage={1} since={Date.now() - 17_000} files={{ done: 1, total: 3 }} tail={{ path: "index.html", lines: ["</body>", "</html>"] }}>
        <PlanCard
          generation={PLAN}
          running
          progress={{ ...NO_PROGRESS, current: "style.css" }}
          disabled
          onStart={() => undefined}
          onCancel={() => undefined}
          progressInHeader
        />
      </FirstBuildRun>,
    );
    const host = screen.getByTestId("first-build-run");
    expect(screen.getByTestId("run-stage").textContent).toBe(`${STAGES[1]} 중…`);
    expect(within(host).getAllByTestId("working-since")[0].textContent).toBe("17초");
    expect(host.querySelector(".run-sweep--top")).not.toBeNull();
    const stages = within(host).getByRole("list", { name: "단계" }).querySelectorAll("li");
    expect(Array.from(stages).map((li) => li.getAttribute("data-state"))).toEqual(["done", "now", "todo"]);
    // The bar lives in the header now; the plan keeps its steps.
    expect(screen.getByTestId("run-file-bar").textContent).toContain("1 / 3 파일");
    expect(screen.queryByTestId("plan-progress")).toBeNull();
    expect(within(screen.getByTestId("plan-card")).getByText("만들 계획")).toBeTruthy();
    expect(screen.getByTestId("run-tail").textContent).toContain("</html>");
  });

  test("점검 단계에서는 머리 줄이 바뀌어요", () => {
    render(
      <FirstBuildRun stage={2} since={null} files={{ done: 3, total: 3 }} tail={null}>
        <p>계획</p>
      </FirstBuildRun>,
    );
    expect(screen.getByTestId("run-stage").textContent).toBe(`${STAGES[2]} 중…`);
    expect(screen.getByTestId("run-file-bar").textContent).toContain("3 / 3 파일");
  });
});
