/**
 * 시작 화면의 템플릿 4종 (app-platform P4) — 화면 쪽.
 *
 * 빈 프로젝트가 기본이고, 템플릿을 고르면 이름이 채워지며 만들기는
 * 템플릿 경로를 부릅니다(무료, 바로 작업 공간으로). Chat에서 온 아이디어가
 * 있을 때는 템플릿이 보이지 않습니다 — 그 길은 그대로입니다.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "@/lib/api";

const TEMPLATES = [
  { key: "ai-chatbot", name: "AI 챗봇", description: "나만의 챗봇.", uses: ["AI", "로그인", "저장"] },
  { key: "poll", name: "투표·설문", description: "회원들이 한 표씩.", uses: ["공유 데이터", "로그인"] },
  { key: "ranking-game", name: "랭킹 게임", description: "20초 색 맞추기.", uses: ["공유 데이터", "로그인"] },
  { key: "club-board", name: "동아리 게시판", description: "글과 댓글.", uses: ["공유 데이터", "로그인", "신고"] },
];

const createBuilderProject = vi.fn();
const createBuilderProjectFromTemplate = vi.fn();
const push = vi.fn();
let chatIdea = { name: "", idea: "" };

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    listBuilderProjects: vi.fn().mockResolvedValue([]),
    listBuilderTemplates: vi.fn().mockResolvedValue(TEMPLATES),
    createBuilderProject: (...args: unknown[]) => createBuilderProject(...args),
    createBuilderProjectFromTemplate: (...args: unknown[]) => createBuilderProjectFromTemplate(...args),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/useChatIdea", () => ({
  useChatIdea: () => chatIdea,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/builder",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: BuilderLibrary } = await import("@/app/builder/BuilderLibrary");

beforeEach(() => {
  vi.clearAllMocks();
  chatIdea = { name: "", idea: "" };
});

describe("시작 화면의 템플릿", () => {
  test("빈 프로젝트가 기본이고, 템플릿 4종이 쓰는 것과 함께 보인다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);
    await user.click((await screen.findAllByRole("button", { name: "+ 새 프로젝트" }))[0]);

    const group = await screen.findByRole("group", { name: "시작 방법" });
    expect(group.querySelectorAll("button")).toHaveLength(5);
    expect(screen.getByRole("button", { name: /빈 프로젝트/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /동아리 게시판/ }).textContent).toContain("공유 데이터");
    expect(screen.getByRole("button", { name: /AI 챗봇/ }).textContent).toContain("AI");
  });

  test("템플릿을 고르면 이름이 채워지고, 만들기는 무료 템플릿 경로로 간다", async () => {
    createBuilderProjectFromTemplate.mockResolvedValue({ id: 12 });
    const user = userEvent.setup();
    render(<BuilderLibrary />);
    await user.click((await screen.findAllByRole("button", { name: "+ 새 프로젝트" }))[0]);
    await screen.findByRole("group", { name: "시작 방법" });

    await user.click(screen.getByRole("button", { name: /투표·설문/ }));
    const name = screen.getByLabelText("새 프로젝트 이름") as HTMLInputElement;
    expect(name.value).toBe("투표·설문");
    expect(screen.getByText(/무료예요/)).toBeTruthy();

    // 다른 템플릿으로 바꾸면 이름도 따라가지만, 직접 적은 이름은 둔다.
    await user.click(screen.getByRole("button", { name: /랭킹 게임/ }));
    expect(name.value).toBe("랭킹 게임");
    await user.clear(name);
    await user.type(name, "점심 내기");
    await user.click(screen.getByRole("button", { name: /동아리 게시판/ }));
    expect(name.value).toBe("점심 내기");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "만들기" }));
    });
    expect(createBuilderProjectFromTemplate).toHaveBeenCalledWith({ template: "club-board", name: "점심 내기" });
    expect(createBuilderProject).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/builder/12");
  });

  test("빈 프로젝트는 예전처럼 만들고, 실패하면 이유를 칸 안에 보여 준다", async () => {
    createBuilderProject.mockRejectedValueOnce(new ApiError("이름이 너무 길어요.", 400));
    const user = userEvent.setup();
    render(<BuilderLibrary />);
    await user.click((await screen.findAllByRole("button", { name: "+ 새 프로젝트" }))[0]);
    await user.type(await screen.findByLabelText("새 프로젝트 이름"), "메모장");
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "만들기" }));
    });
    expect(createBuilderProject).toHaveBeenCalledWith({ name: "메모장", description: "" });
    expect(createBuilderProjectFromTemplate).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toContain("이름이 너무 길어요");
  });

  test("Chat에서 온 아이디어가 있으면 템플릿은 보이지 않는다", async () => {
    chatIdea = { name: "가계부", idea: "한 달 지출을 적는 앱" };
    render(<BuilderLibrary />);
    expect(await screen.findByText(/만들 계획부터 보여 줘요/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "시작 방법" })).toBeNull();
  });
});
