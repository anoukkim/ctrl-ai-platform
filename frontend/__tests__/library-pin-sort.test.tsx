/**
 * ui-improvements — Project Builder 목록의 고정과 정렬.
 *
 * ⋯ 메뉴의 "맨 위에 고정"이 PATCH { pinned: true }를 보내고 그 카드가 맨
 * 앞으로 오며 핀이 붙는다; 정렬 단추가 이름순으로 바꾸면 그 순서가 이
 * 기기에 남는다.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { forgetPrefsInMemory } from "@/lib/layout-prefs";
import type { BuilderProject } from "@/lib/projects";

const project = (id: number, name: string, updated_at: string, pinned_at: string | null = null): BuilderProject => ({
  id,
  name,
  description: "",
  status: "draft",
  github_repo: null,
  app_slug: null,
  draft_slug: null,
  app_runtime_at: null,
  published_version_number: null,
  published_at: null,
  publish_note: "",
  pinned_at,
  created_at: "2026-10-01T00:00:00Z",
  updated_at,
});

const PROJECTS = [
  project(1, "나 둘째", "2026-10-02T00:00:00Z"),
  project(2, "가 셋째", "2026-10-01T00:00:00Z"),
  project(3, "다 첫째", "2026-10-03T00:00:00Z"),
];

const listBuilderProjects = vi.fn();
const updateBuilderProject = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    listBuilderProjects: (...args: unknown[]) => listBuilderProjects(...args),
    listBuilderTemplates: vi.fn().mockResolvedValue([]),
    updateBuilderProject: (...args: unknown[]) => updateBuilderProject(...args),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/useChatIdea", () => ({ useChatIdea: () => ({ name: "", idea: "" }) }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/builder",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: BuilderLibrary } = await import("@/app/builder/BuilderLibrary");

function cardNames(): string[] {
  return screen.getAllByRole("article").map((card) => within(card).getAllByRole("link")[0].getAttribute("aria-label") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetPrefsInMemory();
  window.localStorage.clear();
  listBuilderProjects.mockResolvedValue(PROJECTS);
});

describe("Project Builder 목록의 고정과 정렬", () => {
  test("기본은 마지막 수정순이고, 고정하면 PATCH 뒤 맨 앞에 핀이 붙는다", async () => {
    updateBuilderProject.mockImplementation(async (id: number, changes: { pinned?: boolean }) => ({
      ...PROJECTS.find((p) => p.id === id)!,
      pinned_at: changes.pinned ? "2026-10-05T00:00:00Z" : null,
    }));
    const user = userEvent.setup();
    render(<BuilderLibrary />);
    await waitFor(() => expect(cardNames()).toEqual(["다 첫째", "나 둘째", "가 셋째"]));

    await user.click(screen.getByRole("button", { name: "가 셋째 메뉴" }));
    await user.click(screen.getByRole("menuitem", { name: "맨 위에 고정" }));
    expect(updateBuilderProject).toHaveBeenCalledWith(2, { pinned: true });
    await waitFor(() => expect(cardNames()).toEqual(["가 셋째", "다 첫째", "나 둘째"]));
    const pinnedCard = screen.getAllByRole("article")[0];
    expect(within(pinnedCard).getByRole("img", { name: "고정됨" })).toBeTruthy();

    // The menu now offers 고정 해제, and unpinning sends false.
    await user.click(screen.getByRole("button", { name: "가 셋째 메뉴" }));
    await user.click(screen.getByRole("menuitem", { name: "고정 해제" }));
    expect(updateBuilderProject).toHaveBeenLastCalledWith(2, { pinned: false });
    await waitFor(() => expect(cardNames()).toEqual(["다 첫째", "나 둘째", "가 셋째"]));
  });

  test("정렬을 이름순으로 바꾸면 순서가 바뀌고 이 기기에 남는다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);
    await waitFor(() => expect(cardNames()).toEqual(["다 첫째", "나 둘째", "가 셋째"]));

    await user.click(screen.getByRole("button", { name: "정렬: 마지막 수정순" }));
    await user.click(screen.getByRole("menuitem", { name: "이름순" }));
    await waitFor(() => expect(cardNames()).toEqual(["가 셋째", "나 둘째", "다 첫째"]));
    expect(screen.getByTestId("sort-label").textContent).toBe("이름순");
    expect(window.localStorage.getItem("ctrlai.builder.list-sort.builder")).toBe("name");
  });

  test("카드는 게시한 설명만 보여 주고, 작업 중 프로젝트의 요청 문장은 보여 주지 않는다", async () => {
    listBuilderProjects.mockResolvedValue([
      { ...project(1, "테트리스", "2026-10-02T00:00:00Z"), description: "미니게임 테트리스 만들어줘 3개레벨정도만" },
      { ...project(2, "가계부", "2026-10-01T00:00:00Z"), status: "published", description: "한 달 지출을 적는 앱" },
    ]);
    render(<BuilderLibrary />);
    await waitFor(() => expect(cardNames()).toEqual(["테트리스", "가계부"]));
    expect(screen.queryByText(/미니게임 테트리스 만들어줘/)).toBeNull();
    expect(screen.queryByText("설명이 아직 없습니다.")).toBeNull();
    expect(screen.getByText("한 달 지출을 적는 앱")).toBeTruthy();
  });

  test("기억해 둔 이름순으로 다시 열린다", async () => {
    window.localStorage.setItem("ctrlai.builder.list-sort.builder", "name");
    render(<BuilderLibrary />);
    await waitFor(() => expect(cardNames()).toEqual(["가 셋째", "나 둘째", "다 첫째"]));
  });
});
