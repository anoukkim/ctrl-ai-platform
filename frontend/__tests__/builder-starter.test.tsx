/**
 * 빈 프로젝트의 시작(chat-builder-starter → quality-tuning Q2) — 화면 쪽.
 *
 * 미리보기의 울타리는 정확한 값으로 확인합니다: sandbox는 `allow-scripts`
 * 하나뿐, CSP는 문서 맨 앞, 외부 파일은 불러오지 않음. 나중의 "작은 수정"이
 * 울타리를 넓히면 여기서 깨집니다.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { BuilderFile, BuilderProject } from "@/lib/projects";
import { PREVIEW_CSP, PREVIEW_SANDBOX, buildSrcdoc } from "@/lib/static-preview";

describe("미리보기 문서", () => {
  const files = {
    "index.html":
      '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head>' +
      '<body><h1>안녕</h1><script src="app.js"></script>' +
      '<script src="https://evil.example/x.js"></script></body></html>',
    "style.css": "h1 { color: red; }",
    "app.js": "document.title = '</script><b>깨짐</b>';",
  };

  test("sandbox는 allow-scripts 하나뿐이다", () => {
    expect(PREVIEW_SANDBOX).toBe("allow-scripts");
  });

  test("CSP가 head 맨 앞에 오고 네트워크를 모두 막는다", () => {
    const doc = buildSrcdoc(files)!;
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<style>"));
    expect(doc).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`);
    expect(PREVIEW_CSP).toMatch(/^default-src 'none';/);
    expect(PREVIEW_CSP).not.toMatch(/connect-src|https?:/);
  });

  test("프로젝트의 CSS와 JS는 문서 안으로, 바깥 파일은 버린다", () => {
    const doc = buildSrcdoc(files)!;
    expect(doc).toContain("<style>h1 { color: red; }</style>");
    expect(doc).toContain("document.title");
    expect(doc).not.toContain("evil.example");
    expect(doc).not.toContain('src="app.js"');
  });

  test("스크립트 안의 </script>가 태그를 일찍 닫지 못한다", () => {
    const doc = buildSrcdoc(files)!;
    expect(doc).toContain("<\\/script><b>깨짐</b>");
  });

  test("index.html이 없으면 문서를 만들지 않는다", () => {
    expect(buildSrcdoc({ "app.js": "1" })).toBeNull();
  });
});

// ------------------------------------------------------------ 작업 공간

const PROJECT: BuilderProject = {
  id: 7,
  name: "가계부",
  description: "한 달 지출을 적는 앱",
  status: "draft",
  github_repo: null,
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
};

const STARTER_FILES: BuilderFile[] = [
  { path: "index.html", content: "<!doctype html><h1>가계부</h1>", updated_at: "" },
  { path: "app.js", content: "console.log(1)", updated_at: "" },
];

const listBuilderFiles = vi.fn();
const createBuilderProject = vi.fn();
const planGeneration = vi.fn();
const runGeneration = vi.fn();
const push = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getBuilderProject: vi.fn().mockResolvedValue(PROJECT),
    listBuilderProjects: vi.fn().mockResolvedValue([]),
    listBuilderFiles: (...args: unknown[]) => listBuilderFiles(...args),
    createBuilderProject: (...args: unknown[]) => createBuilderProject(...args),
    listVersions: vi.fn().mockResolvedValue([]),
    getGenerateEstimate: vi.fn().mockRejectedValue(new Error("없음")),
  };
});

vi.mock("@/lib/generation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation")>();
  return {
    ...actual,
    getOpenGeneration: vi.fn().mockResolvedValue(null),
    planGeneration: (...args: unknown[]) => planGeneration(...args),
    runGeneration: (...args: unknown[]) => runGeneration(...args),
    cancelGeneration: vi.fn().mockResolvedValue({}),
  };
});

const PLAN = {
  id: 3,
  kind: "create",
  request: "한 달 지출을 적는 앱",
  style: "",
  summary: "가계부를 파일 2개로 만들어요.",
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
  created_at: "2026-10-15T00:00:00Z",
  estimated_krw: 90,
  max_call_krw: 300,
};

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/useChatIdea", () => ({
  useChatIdea: () => ({ name: "가계부", idea: "한 달 지출을 적는 가계부 앱" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/builder",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: BuilderWorkspace } = await import("@/app/builder/[projectId]/BuilderWorkspace");
const { default: BuilderLibrary } = await import("@/app/builder/BuilderLibrary");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("빈 프로젝트의 작업 공간", () => {
  test("짧은 질문 → 만들 계획 → 시작하면 파일이 하나씩 써지고 미리보기가 나온다", async () => {
    listBuilderFiles.mockResolvedValueOnce([]).mockResolvedValue(STARTER_FILES);
    planGeneration.mockResolvedValue(PLAN);
    runGeneration.mockImplementation(async (_project, _id, handlers) => {
      handlers.onFileStart?.("index.html");
      handlers.onFileDone?.("index.html", 20);
      handlers.onFileStart?.("app.js");
      handlers.onFileDone?.("app.js", 15);
      handlers.onCheckStart?.();
      handlers.onCheckDone?.([], "점검했어요 — 고칠 곳이 없어요.", 5);
      return { kind: "done", versionNumber: 1, chargedKrw: 43, filesDone: ["index.html", "app.js"], checkFixed: [] };
    });
    const user = userEvent.setup();
    const { container } = render(<BuilderWorkspace projectId="7" />);

    // Chat에서 온 아이디어(프로젝트 설명)가 미리 채워져 있습니다.
    const idea = (await screen.findByLabelText("만들고 싶은 앱")) as HTMLTextAreaElement;
    expect(idea.value).toBe("한 달 지출을 적는 앱");
    await user.type(screen.getByLabelText("누가 쓰나요?"), "나 혼자");
    await user.click(screen.getByRole("button", { name: "귀여운" }));
    await user.click(screen.getByRole("button", { name: "만들 계획 세우기" }));

    expect(planGeneration).toHaveBeenCalledWith("7", {
      request: "한 달 지출을 적는 앱",
      who: "나 혼자",
      features: "",
      style: "귀여운",
      mood: "귀여운",
    });
    const card = await screen.findByTestId("plan-card");
    expect(card.textContent).toContain("index.html");
    expect(card.textContent).toContain("저장 동작");
    const start = screen.getByRole("button", { name: /시작 · 약 90원 \(호출마다 최대 300원\)/ });
    await user.click(start);

    expect(runGeneration).toHaveBeenCalledWith("7", 3, expect.anything());
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(container.querySelector("iframe")!.getAttribute("sandbox")).toBe("allow-scripts");
  });

  test("질문은 건너뛸 수 있다", async () => {
    listBuilderFiles.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.click(await screen.findByRole("button", { name: "질문 건너뛰기" }));
    expect(screen.queryByLabelText("누가 쓰나요?")).toBeNull();
    expect(screen.getByLabelText("만들고 싶은 앱")).toBeTruthy();
  });

  test("멈춘 만들기는 한국어 이유와 이어서 만들기를 남긴다", async () => {
    listBuilderFiles.mockResolvedValue([]);
    planGeneration.mockResolvedValue(PLAN);
    runGeneration.mockResolvedValue({
      kind: "error",
      detail: "app.js을(를) 쓰다 멈췄어요: 제공자가 제시간에 응답하지 않았습니다.",
      partial: true,
      filesDone: ["index.html"],
    });
    const { getOpenGeneration } = await import("@/lib/generation");
    vi.mocked(getOpenGeneration)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        ...PLAN,
        status: "partial",
        files_done: ["index.html"],
        error: "app.js을(를) 쓰다 멈췄어요: 제공자가 제시간에 응답하지 않았습니다.",
      } as never);
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.click(await screen.findByRole("button", { name: "만들 계획 세우기" }));
    await user.click(await screen.findByRole("button", { name: /^시작/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("다 쓴 파일은 저장돼 있어요");
    expect(screen.getByRole("button", { name: /^이어서 만들기/ })).toBeTruthy();
  });

  test("파일이 있는 프로젝트는 질문 없이 미리보기로 열린다", async () => {
    listBuilderFiles.mockResolvedValue(STARTER_FILES);
    const { container } = render(<BuilderWorkspace projectId="7" />);

    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "만들 계획 세우기" })).toBeNull();
  });
});

describe("Chat에서 온 새 프로젝트", () => {
  test("만들면 아이디어를 설명으로 저장하고 작업 공간으로 간다 — 돈은 계획부터", async () => {
    createBuilderProject.mockResolvedValue({ ...PROJECT, id: 9 });
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    expect(await screen.findByText(/만들 계획부터 보여 줘요/)).toBeTruthy();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "만들기" }));
    });

    expect(createBuilderProject).toHaveBeenCalledWith({
      name: "가계부",
      description: "한 달 지출을 적는 가계부 앱",
    });
    expect(planGeneration).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/builder/9");
  });
});
