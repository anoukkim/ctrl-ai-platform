/**
 * 예시 앱 (chat-builder-starter) — 화면 쪽.
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
const createStarterApp = vi.fn();
const createBuilderProject = vi.fn();
const push = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getBuilderProject: vi.fn().mockResolvedValue(PROJECT),
    listBuilderProjects: vi.fn().mockResolvedValue([]),
    listBuilderFiles: (...args: unknown[]) => listBuilderFiles(...args),
    createStarterApp: (...args: unknown[]) => createStarterApp(...args),
    createBuilderProject: (...args: unknown[]) => createBuilderProject(...args),
    getStarterEstimate: vi
      .fn()
      .mockResolvedValue({ estimated_krw: 60, worst_case_krw: 130, model_label: "Sonnet 5.5" }),
  };
});

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
  test("예시 앱을 만들면 파일과 안전한 미리보기가 나온다", async () => {
    listBuilderFiles.mockResolvedValue([]);
    createStarterApp.mockResolvedValue({
      files: STARTER_FILES,
      summary: "가계부의 첫 버전이에요.",
      charged_krw: 48,
    });
    const user = userEvent.setup();
    const { container } = render(<BuilderWorkspace projectId="7" />);

    const button = await screen.findByRole("button", { name: "예시 앱 만들기" });
    expect(await screen.findByText(/약 60원 · 최대 130원/)).toBeTruthy();
    await user.click(button);

    expect(createStarterApp).toHaveBeenCalledWith("7", "한 달 지출을 적는 앱");
    expect(await screen.findByText("가계부의 첫 버전이에요.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /app\.js/ })).toBeTruthy();
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("Content-Security-Policy");
  });

  test("파일이 있는 프로젝트는 예시 앱 단추 없이 미리보기로 열린다", async () => {
    listBuilderFiles.mockResolvedValue(STARTER_FILES);
    const { container } = render(<BuilderWorkspace projectId="7" />);

    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "예시 앱 만들기" })).toBeNull();
  });
});

describe("Chat에서 온 새 프로젝트", () => {
  test("예시 앱까지 만들기가 켜져 있고, 만들면 작업 공간으로 간다", async () => {
    createBuilderProject.mockResolvedValue({ ...PROJECT, id: 9 });
    createStarterApp.mockResolvedValue({ files: STARTER_FILES, summary: "", charged_krw: 48 });
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    const checkbox = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(await screen.findByText(/약 60원 \(최대 130원\)/)).toBeTruthy();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "만들기" }));
    });

    expect(createBuilderProject).toHaveBeenCalledWith({
      name: "가계부",
      description: "한 달 지출을 적는 가계부 앱",
    });
    expect(createStarterApp).toHaveBeenCalledWith(9, "한 달 지출을 적는 가계부 앱");
    expect(push).toHaveBeenCalledWith("/builder/9");
  });

  test("예시 앱이 실패해도 만든 프로젝트로 가는 길을 남긴다", async () => {
    createBuilderProject.mockResolvedValue({ ...PROJECT, id: 9 });
    createStarterApp.mockRejectedValue(new Error("지원금이 부족합니다"));
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await screen.findByRole("checkbox");
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "만들기" }));
    });

    expect((await screen.findByRole("alert")).textContent).toContain("예시 앱은 만들지 못했습니다");
    expect(screen.getByRole("link", { name: /다시 시도/ }).getAttribute("href")).toBe("/builder/9");
    expect(push).not.toHaveBeenCalled();
  });
});
