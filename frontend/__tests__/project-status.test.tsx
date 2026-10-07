/**
 * 프로젝트 상태 표시 — 회원이 보는 배지는 "Draft"와 "게시됨" 둘뿐이고,
 * 만드는 중(building, generating)에는 배지 대신 "생성 중…"입니다.
 * 그리고 Project Builder 목록의 세 거르기가 백엔드에 같은 값을 보내는지.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ProjectStatusBadge from "@/app/components/ProjectStatusBadge";
import {
  BUILDER_STATUS_LABEL,
  LIBRARY_FILTERS,
  VIDEO_STATUS_LABEL,
  projectBadge,
  type BuilderProject,
  type BuilderProjectStatus,
  type VideoProjectStatus,
} from "@/lib/projects";

const BUILDER_STATUSES: BuilderProjectStatus[] = ["draft", "building", "ready", "published"];
const VIDEO_STATUSES: VideoProjectStatus[] = ["draft", "generating", "ready", "published"];
const BADGES = new Set(["Draft", "게시됨"]);

describe("상태 배지는 Draft와 게시됨뿐", () => {
  test.each([...BUILDER_STATUSES, ...VIDEO_STATUSES])("%s", (status) => {
    const badge = projectBadge(status);
    if (status === "building" || status === "generating") {
      expect(badge).toEqual({ kind: "working", label: "생성 중…" });
    } else {
      expect(badge.kind).toBe("badge");
      expect(BADGES.has(badge.label)).toBe(true);
      expect(badge.label).toBe(status === "published" ? "게시됨" : "Draft");
    }
  });

  test.each([...BUILDER_STATUSES, ...VIDEO_STATUSES])("그려진 %s 배지", (status) => {
    render(<ProjectStatusBadge status={status} />);
    const working = status === "building" || status === "generating";
    if (working) {
      expect(screen.getByRole("status").textContent).toBe("생성 중…");
      expect(document.querySelector(".badge")).toBeNull();
    } else {
      const badge = document.querySelector(".badge");
      expect(BADGES.has(badge?.textContent ?? "")).toBe(true);
    }
  });

  test("예전 이름표 표도 같은 규칙을 따른다 — 보관(archived)은 없다", () => {
    const labels = new Set([
      ...Object.values(BUILDER_STATUS_LABEL),
      ...Object.values(VIDEO_STATUS_LABEL),
    ]);
    expect(labels).toEqual(new Set(["Draft", "게시됨", "생성 중…"]));
    expect(Object.keys(BUILDER_STATUS_LABEL)).not.toContain("archived");
    expect(Object.keys(VIDEO_STATUS_LABEL)).not.toContain("archived");
  });

  test("거르기는 정확히 셋: 전체 / Draft / 게시됨", () => {
    expect(LIBRARY_FILTERS).toEqual([
      { value: "all", label: "전체" },
      { value: "draft", label: "Draft" },
      { value: "published", label: "게시됨" },
    ]);
  });
});

// ------------------------------------------------------------ Builder 목록

const listBuilderProjects = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return { ...actual, listBuilderProjects: (...args: unknown[]) => listBuilderProjects(...args) };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ quarter: null, loading: false, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

function builder(overrides: Partial<BuilderProject> = {}): BuilderProject {
  return {
    id: 1,
    name: "습관 관리 앱",
    description: "",
    status: "draft",
    github_repo: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("Project Builder 목록", () => {
  beforeEach(() => {
    listBuilderProjects.mockReset();
  });

  test("세 거르기가 백엔드에 all / draft / published를 보낸다", async () => {
    listBuilderProjects.mockResolvedValue([builder()]);
    const { default: BuilderLibrary } = await import("@/app/builder/BuilderLibrary");
    render(<BuilderLibrary />);
    await screen.findByText("습관 관리 앱");
    expect(listBuilderProjects).toHaveBeenLastCalledWith("all");

    const group = screen.getByRole("group", { name: "상태" });
    for (const [label, value] of [
      ["Draft", "draft"],
      ["게시됨", "published"],
      ["전체", "all"],
    ]) {
      await userEvent.click(within(group).getByRole("button", { name: label }));
      expect(listBuilderProjects).toHaveBeenLastCalledWith(value);
    }
  });

  test("카드는 Draft / 게시됨 / 생성 중… 외의 상태를 보이지 않는다", async () => {
    listBuilderProjects.mockResolvedValue([
      builder({ id: 1, name: "a", status: "draft" }),
      builder({ id: 2, name: "b", status: "building" }),
      builder({ id: 3, name: "c", status: "ready" }),
      builder({ id: 4, name: "d", status: "published" }),
    ]);
    const { default: BuilderLibrary } = await import("@/app/builder/BuilderLibrary");
    render(<BuilderLibrary />);
    await screen.findByText("d");

    const shown = [...document.querySelectorAll("article .badge, article .working")].map(
      (node) => node.textContent,
    );
    expect(shown.sort()).toEqual(["Draft", "Draft", "게시됨", "생성 중…"].sort());
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.queryByText("Building")).toBeNull();
    // 빗금 자리는 Phase 3까지 "미리보기 썸네일"이라고 적혀 있습니다.
    expect(screen.getAllByText("미리보기 썸네일")).toHaveLength(4);
  });
});
