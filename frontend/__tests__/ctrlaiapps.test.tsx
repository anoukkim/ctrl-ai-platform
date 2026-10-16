/**
 * ctrlaiapps-publish — CtrlAIApps 목록·상세와 Builder의 게시.
 *
 * 예시 앱은 없고 백엔드가 준 것만 보입니다. 상세는 앱 주소를 그대로,
 * 정확한 sandbox로 띄웁니다. Builder는 "게시됨 v1 · 작업 중 v3"을 보여 주고,
 * 업데이트 게시 전에 v1 → v3을 말합니다.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AppListing } from "@/lib/apps";
import { RUNTIME_SANDBOX } from "@/lib/static-preview";
import type { BuilderFile, BuilderProject, BuilderVersion } from "@/lib/projects";

const APP: AppListing = {
  id: 7,
  slug: "k3m9qx7pwa",
  name: "오늘 할 일",
  description: "할 일을 적고 지우는 앱이에요.",
  author_name: "김유리",
  author_username: "yurikim",
  version_number: 3,
  published_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  publish_note: "메모 기능을 추가했어요",
  app_url: "http://apps.test/k3m9qx7pwa/",
};

const appsApi = {
  listApps: vi.fn(),
  getApp: vi.fn(),
  reportApp: vi.fn(),
};

vi.mock("@/lib/apps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apps")>();
  return {
    ...actual,
    listApps: (...args: unknown[]) => appsApi.listApps(...args),
    getApp: (...args: unknown[]) => appsApi.getApp(...args),
    reportApp: (...args: unknown[]) => appsApi.reportApp(...args),
  };
});

const PROJECT: BuilderProject = {
  id: 7,
  name: "오늘 할 일",
  description: "할 일 앱",
  status: "published",
  github_repo: null,
  app_slug: "k3m9qx7pwa",
  draft_slug: "d7r4ftw2pq",
  app_runtime_at: "2026-10-14T10:00:00Z",
  published_version_number: 1,
  published_at: "2026-10-14T09:00:00Z",
  publish_note: "",
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
};

const FILES: BuilderFile[] = [{ path: "index.html", content: "<h1>할 일</h1>", updated_at: "" }];
const versions = (n: number): BuilderVersion[] =>
  Array.from({ length: n }, (_, i) => ({
    number: n - i,
    note: `고치기 ${n - i}`,
    created_at: "2026-10-14T09:00:00Z",
    file_count: 1,
    total_bytes: 10,
    published: n - i === 1,
  }));

const projectsApi = { publishProject: vi.fn(), generateProject: vi.fn(), labelVersion: vi.fn() };

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getBuilderProject: vi.fn().mockResolvedValue(PROJECT),
    listBuilderProjects: vi.fn().mockResolvedValue([]),
    listBuilderFiles: vi.fn().mockResolvedValue(FILES),
    listVersions: vi.fn().mockResolvedValue(versions(3)),
    getGenerateEstimate: vi.fn().mockResolvedValue({
      estimated_krw: 70,
      worst_case_krw: 240,
      model_label: "Sonnet 5.5",
      max_output_tokens: 16000,
    }),
    publishProject: (...args: unknown[]) => projectsApi.publishProject(...args),
    generateProject: (...args: unknown[]) => projectsApi.generateProject(...args),
    labelVersion: (...args: unknown[]) => projectsApi.labelVersion(...args),
  };
});

vi.mock("@/app/components/SiteProvider", () => ({
  useSite: () => ({ apps_base_url: "http://apps.test", test_mode: { builder: false } }),
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
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: AppGrid } = await import("@/app/ctrlaistore/AppGrid");
const { default: AppDetail } = await import("@/app/ctrlaistore/[slug]/AppDetail");
const { default: BuilderWorkspace } = await import("@/app/builder/[projectId]/BuilderWorkspace");

beforeEach(() => vi.clearAllMocks());

describe("CtrlAIApps 목록", () => {
  test("아무도 게시하지 않았으면 친절한 빈 화면 — 예시 앱은 없다", async () => {
    appsApi.listApps.mockResolvedValue([]);
    render(<AppGrid />);
    expect(await screen.findByText("아직 게시된 앱이 없어요")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Project Builder로 가기" })).toBeTruthy();
  });

  test("카드: 이름 · 설명 · 만든 사람 · 'v3 · 3일 전 업데이트' · 메모", async () => {
    appsApi.listApps.mockResolvedValue([APP]);
    render(<AppGrid />);
    const card = await screen.findByRole("link", { name: /오늘 할 일/ });
    expect(card.getAttribute("href")).toBe("/ctrlaistore/k3m9qx7pwa");
    expect(within(card).getByText("김유리")).toBeTruthy();
    expect(within(card).getByText("v3 · 3일 전 업데이트")).toBeTruthy();
    expect(within(card).getByText("메모 기능을 추가했어요")).toBeTruthy();
  });
});

describe("앱 상세", () => {
  test("앱 실행은 앱 주소, 미리보기는 정확한 sandbox, 솔직한 안내", async () => {
    appsApi.getApp.mockResolvedValue(APP);
    const { container } = render(<AppDetail slug="k3m9qx7pwa" />);
    const run = await screen.findByRole("link", { name: "앱 실행" });
    expect(run.getAttribute("href")).toBe(APP.app_url);
    expect(run.getAttribute("rel")).toContain("noopener");
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(APP.app_url);
    expect(frame.getAttribute("sandbox")).toBe(RUNTIME_SANDBOX);
    expect(screen.getByText(/내가 허용한 뒤에만 쓰고, AI는 내 지원금에서/)).toBeTruthy();
  });

  test("신고는 사유를 적어 보낸다", async () => {
    appsApi.getApp.mockResolvedValue(APP);
    appsApi.reportApp.mockResolvedValue({ detail: "신고를 받았어요." });
    const user = userEvent.setup();
    render(<AppDetail slug="k3m9qx7pwa" />);
    await user.click(await screen.findByRole("button", { name: "신고하기" }));
    await user.type(screen.getByLabelText(/무엇이 문제인가요/), "비밀번호를 물어봐요");
    await user.click(screen.getByRole("button", { name: "신고 보내기" }));
    expect(appsApi.reportApp).toHaveBeenCalledWith("k3m9qx7pwa", "비밀번호를 물어봐요");
  });
});

describe("Builder의 게시", () => {
  test("머리에 '게시됨 v1 · 작업 중 v3', 업데이트 게시는 v1 → v3을 먼저 말한다", async () => {
    projectsApi.publishProject.mockResolvedValue({ ...PROJECT, published_version_number: 3 });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await waitFor(() =>
      expect(screen.getByTestId("version-status").textContent).toBe("게시됨 v1 · 작업 중 v3"),
    );
    await user.click(screen.getByRole("button", { name: "업데이트 게시" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("publish-change").textContent).toContain("v1 → v3");
    expect(within(dialog).getByText(/허용한 뒤에만 되고, AI는 쓰는 사람의 지원금에서/)).toBeTruthy();

    await user.type(within(dialog).getByLabelText(/업데이트 메모/), "메모 기능 추가");
    fireEvent.click(within(dialog).getByRole("button", { name: "업데이트 게시" }));
    await waitFor(() =>
      expect(projectsApi.publishProject).toHaveBeenCalledWith("7", {
        name: "오늘 할 일",
        description: "할 일 앱",
        note: "메모 기능 추가",
      }),
    );
  });

  test("미리보기는 작업 중 / 게시된 버전을 고른다", async () => {
    const user = userEvent.setup();
    const { container } = render(<BuilderWorkspace projectId="7" />);
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(container.querySelector("iframe")!.getAttribute("src")).toContain("/d7r4ftw2pq/");

    // 도구 줄 맨 앞의 버전 고르기 (quality-tuning Q3).
    await user.selectOptions(await screen.findByLabelText("미리볼 버전"), "게시된 v1");
    expect(container.querySelector("iframe")!.getAttribute("src")).toContain("/k3m9qx7pwa/");
  });

  test("버전에 이름을 붙이고 고정한다", async () => {
    projectsApi.labelVersion.mockResolvedValue({ ...versions(3)[1], pinned: true });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);
    await user.click(await screen.findByText("모든 버전 (3)"));
    await user.click(screen.getByRole("button", { name: "v2 고정하기" }));
    expect(projectsApi.labelVersion).toHaveBeenCalledWith("7", 2, { pinned: true });

    await user.click(screen.getByRole("button", { name: "v2 이름 붙이기" }));
    await user.type(screen.getByLabelText("v2에 붙일 이름"), "메모 기능 추가{Enter}");
    expect(projectsApi.labelVersion).toHaveBeenCalledWith("7", 2, { label: "메모 기능 추가" });
  });
});
