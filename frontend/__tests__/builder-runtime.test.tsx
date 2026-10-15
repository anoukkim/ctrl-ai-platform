/**
 * builder-static-runtime — 화면 쪽.
 *
 * 울타리는 정확한 값으로 확인합니다: 앱 주소 프레임(셸, app-platform P1)의
 * sandbox는 정해진 값 그대로, 본문 없는 POST도 JSON으로 갑니다
 * (apps.ctrlai.my가 같은 사이트라서 백엔드는 JSON 아닌 POST를 거절합니다).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { request } from "@/lib/http";
import type { BuilderFile, BuilderProject, BuilderVersion } from "@/lib/projects";
import {
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
  RUNTIME_SANDBOX,
  STORAGE_SHIM,
  buildSrcdoc,
} from "@/lib/static-preview";

const RUNTIME_SANDBOX_VALUE =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

describe("울타리", () => {
  test("앱 주소 프레임(셸)의 sandbox는 정해진 값뿐이다 — 맨 위 이동·알림창은 막힌다", () => {
    // 셸은 apps 출처의 CTRL+AI 페이지라 자기 저장소를 쓰려고 allow-same-origin이
    // 필요합니다. 회원의 코드는 셸 안에서 allow-same-origin 없이 돕니다.
    expect(RUNTIME_SANDBOX).toBe(RUNTIME_SANDBOX_VALUE);
    expect(RUNTIME_SANDBOX).not.toContain("allow-top-navigation");
    expect(RUNTIME_SANDBOX).not.toContain("allow-modals");

    expect(PREVIEW_SANDBOX).toBe("allow-scripts");
  });

  test("페이지 안 미리보기에도 저장소 대체가 CSP 바로 뒤, 앱보다 먼저 들어간다", () => {
    const doc = buildSrcdoc({ "index.html": "<html><head><title>t</title></head><body>앱</body></html>" })!;
    expect(doc).toContain(
      `<head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">${STORAGE_SHIM}<title>`,
    );
  });
});

describe("요청 형식", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("본문 없는 POST도 {}를 JSON으로 보낸다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await request("/auth/logout", { method: "POST" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe("{}");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  test("GET에는 본문도 형식도 붙이지 않는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await request("/builder/projects");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers["Content-Type"]).toBeUndefined();
  });
});

// ------------------------------------------------------------ 작업 공간

const PROJECT: BuilderProject = {
  id: 7,
  name: "할 일",
  description: "",
  status: "draft",
  github_repo: null,
  app_slug: null,
  draft_slug: "k3m9qx7pwa",
  app_runtime_at: "2026-10-14T10:00:00Z",
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
};

const FILES: BuilderFile[] = [
  { path: "index.html", content: "<!doctype html><h1>할 일</h1>", updated_at: "" },
  { path: "style.css", content: "button { background: #3b6cf6; }", updated_at: "" },
];

const V1: BuilderVersion = {
  number: 1,
  note: "예시 앱",
  created_at: "2026-10-14T09:00:00Z",
  file_count: 2,
  total_bytes: 60,
};

const generateProject = vi.fn();
const restoreVersion = vi.fn();
const listVersions = vi.fn();
let appsBase: string | null = "http://apps.test";

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getBuilderProject: vi.fn().mockResolvedValue(PROJECT),
    listBuilderProjects: vi.fn().mockResolvedValue([]),
    listBuilderFiles: vi.fn().mockResolvedValue(FILES),
    listVersions: (...args: unknown[]) => listVersions(...args),
    generateProject: (...args: unknown[]) => generateProject(...args),
    restoreVersion: (...args: unknown[]) => restoreVersion(...args),
    getGenerateEstimate: vi.fn().mockResolvedValue({
      estimated_krw: 70,
      worst_case_krw: 240,
      model_label: "Sonnet 5.5",
      max_output_tokens: 16000,
    }),
    getStarterEstimate: vi.fn().mockResolvedValue({ estimated_krw: 60, worst_case_krw: 130, model_label: "Sonnet 5.5" }),
  };
});

vi.mock("@/app/components/SiteProvider", () => ({
  useSite: () => ({ apps_base_url: appsBase, test_mode: { builder: false } }),
  useSiteLoaded: () => true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/builder/7",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: BuilderWorkspace } = await import("@/app/builder/[projectId]/BuilderWorkspace");

beforeEach(() => {
  vi.clearAllMocks();
  appsBase = "http://apps.test";
  listVersions.mockResolvedValue([V1]);
});

describe("앱 주소 미리보기", () => {
  test("올라간 앱은 앱 주소를 그대로, 정확한 sandbox로 띄운다", async () => {
    const { container } = render(<BuilderWorkspace projectId="7" />);

    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(
      `http://apps.test/k3m9qx7pwa/?v=${encodeURIComponent(PROJECT.app_runtime_at!)}`,
    );
    expect(frame.getAttribute("sandbox")).toBe(RUNTIME_SANDBOX_VALUE);
    expect(frame.getAttribute("srcdoc")).toBeNull();
    expect(screen.getByRole("button", { name: "미리보기 갱신" })).toBeTruthy();
  });

  test("앱 서버가 꺼져 있으면 예전처럼 페이지 안에서 돌린다", async () => {
    appsBase = null;
    const { container } = render(<BuilderWorkspace projectId="7" />);

    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(screen.queryByRole("button", { name: "미리보기 갱신" })).toBeNull();
  });
});

describe("말로 고치기와 버전", () => {
  test("비용을 먼저 보여 주고, 고치면 Claude의 답과 새 버전이 나온다", async () => {
    generateProject.mockResolvedValue({
      files: [FILES[0], { ...FILES[1], content: "button { background: #e8590c; }" }],
      changed: ["style.css"],
      summary: "버튼 색을 주황색으로 바꿨어요.",
      charged_krw: 52,
      version: { ...V1, number: 2, note: "고치기: 버튼 색을 바꿔 줘" },
      project: PROJECT,
    });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    expect(await screen.findByText(/약 70원 · 최대 240원/)).toBeTruthy();
    await user.type(screen.getByLabelText("Claude에게 만들거나 고쳐 달라고 하기"), "버튼 색을 바꿔 줘");
    await user.click(screen.getByRole("button", { name: "고치기" }));

    expect(generateProject).toHaveBeenCalledWith("7", "버튼 색을 바꿔 줘", "");
    expect(await screen.findByText("버튼 색을 주황색으로 바꿨어요.")).toBeTruthy();
    expect(screen.getByText("버전 기록 (2)")).toBeTruthy();
    expect(screen.getByText("고치기: 버튼 색을 바꿔 줘")).toBeTruthy();
  });

  test("되돌리기는 확인을 받고, 무료라고 알린다", async () => {
    listVersions.mockResolvedValue([{ ...V1, number: 2, note: "고치기: 색" }, V1]);
    restoreVersion.mockResolvedValue({
      files: FILES,
      version: { ...V1, number: 3, note: "v1로 되돌리기" },
      project: PROJECT,
    });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.click(await screen.findByText("버전 기록 (2)"));
    await user.click(screen.getByRole("button", { name: "되돌리기" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/비용은 들지 않고/)).toBeTruthy();
    expect(within(dialog).getByText("v1로 되돌리기")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "되돌리기" }));

    expect(restoreVersion).toHaveBeenCalledWith("7", 1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
