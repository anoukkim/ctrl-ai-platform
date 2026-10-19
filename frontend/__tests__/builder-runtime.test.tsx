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
import type { BuilderFile, BuilderHistory, BuilderProject, BuilderVersion } from "@/lib/projects";
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

const planGeneration = vi.fn();
const runGeneration = vi.fn();
const restoreVersion = vi.fn();
const saveVersion = vi.fn();
const restoreStep = vi.fn();
const getHistory = vi.fn();
const listVersions = vi.fn();
const routerPush = vi.fn();

const CLEAN: BuilderHistory = {
  steps: [],
  can_undo: false,
  can_redo: false,
  unsaved: false,
  reference_version_number: 2,
  latest_version_number: 2,
};
const UNSAVED: BuilderHistory = { ...CLEAN, unsaved: true };
let appsBase: string | null = "http://apps.test";

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getBuilderProject: vi.fn().mockResolvedValue(PROJECT),
    listBuilderProjects: vi.fn().mockResolvedValue([]),
    listBuilderFiles: vi.fn().mockResolvedValue(FILES),
    listVersions: (...args: unknown[]) => listVersions(...args),
    restoreVersion: (...args: unknown[]) => restoreVersion(...args),
    saveVersion: (...args: unknown[]) => saveVersion(...args),
    restoreStep: (...args: unknown[]) => restoreStep(...args),
    getHistory: (...args: unknown[]) => getHistory(...args),
    getGenerateEstimate: vi.fn().mockResolvedValue({
      estimated_krw: 70,
      worst_case_krw: 240,
      model_label: "Sonnet 5.5",
      max_output_tokens: 16000,
    }),
    getStarterEstimate: vi.fn().mockResolvedValue({ estimated_krw: 60, worst_case_krw: 130, model_label: "Sonnet 5.5" }),
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

const toastShow = vi.fn();
vi.mock("@/app/components/ToastProvider", () => ({
  useToast: () => ({ show: toastShow }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

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
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/builder/7",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: BuilderWorkspace } = await import("@/app/builder/[projectId]/BuilderWorkspace");

beforeEach(() => {
  vi.clearAllMocks();
  appsBase = "http://apps.test";
  listVersions.mockResolvedValue([V1]);
  getHistory.mockResolvedValue({ ...CLEAN, reference_version_number: 1, latest_version_number: 1 });
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
  test("비용을 먼저 보여 주고, 고치면 계획 → 파일 → 점검 뒤 Claude의 답과 새 버전이 나온다", async () => {
    planGeneration.mockResolvedValue({
      id: 4,
      kind: "edit",
      request: "버튼 색을 바꿔 줘",
      style: "",
      summary: "버튼 색을 주황색으로 바꿔요.",
      plan: [{ path: "style.css", purpose: "색과 배치" }],
      files_done: [],
      status: "planned",
      check_summary: "",
      check_fixed: [],
      charged_krw: 3,
      error: "",
      version_number: null,
      created_at: "2026-10-15T00:00:00Z",
      estimated_krw: 40,
      max_call_krw: 200,
    });
    runGeneration.mockImplementation(async (_project, _id, handlers) => {
      handlers.onFileStart?.("style.css");
      handlers.onFileDone?.("style.css", 40);
      handlers.onCheckStart?.();
      handlers.onCheckDone?.([], "점검했어요 — 고칠 곳이 없어요.", 9);
      // builder-snapshots: a run is a 작업 step (no new version, but unsaved work).
      getHistory.mockResolvedValue({
        ...CLEAN,
        unsaved: true,
        can_undo: true,
        reference_version_number: 1,
        latest_version_number: 1,
        steps: [
          { seq: 1, note: "처음 상태", created_at: "2026-10-14T09:00:00Z", current: false },
          {
            seq: 2,
            note: "고치기: 버튼 색을 바꿔 줘",
            created_at: "2026-10-15T09:00:00Z",
            current: true,
            request: "버튼 색을 바꿔 줘",
            summary: "버튼 색을 주황색으로 바꿔요.",
            changed_count: 1,
            charged_krw: 52,
          },
        ],
      });
      return { kind: "done", chargedKrw: 52, filesDone: ["style.css"], checkFixed: [] };
    });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    expect(await screen.findByText(/약 70원 · 최대 240원/)).toBeTruthy();
    await user.type(screen.getByLabelText("Claude에게 만들거나 고쳐 달라고 하기"), "버튼 색을 바꿔 줘");
    await user.click(screen.getByRole("button", { name: "고치기" }));

    // 고치기는 계획이 나오면 바로 시작합니다.
    expect(planGeneration).toHaveBeenCalledWith("7", { request: "버튼 색을 바꿔 줘" });
    expect(runGeneration).toHaveBeenCalledWith("7", 4, expect.anything());
    // 끝나면 Claude 판의 대화에 부탁 → 한 일 + "파일 1개 바뀜 · 52원" (Q3).
    const history = await screen.findByRole("list", { name: "바뀌어 온 기록" });
    expect(await within(history).findByText(/파일 1개 바뀜 · 52원/)).toBeTruthy();
    expect(within(history).getByText("버튼 색을 바꿔 줘")).toBeTruthy();
    expect(within(history).getByText(/버튼 색을 주황색으로 바꿔요\./)).toBeTruthy();
    expect(within(history).getByRole("button", { name: /처음 상태 때로 되돌리기/ })).toBeTruthy();
    // 새 버전은 안 생겼고, 저장 안 한 작업으로 보입니다.
    expect(await screen.findByText("저장한 버전 (1)")).toBeTruthy();
    expect(await screen.findByText("작업 중 · v1 이후 바뀐 것", { selector: "option" })).toBeTruthy();
  });

  test("builder-answer-only: 질문에는 답만 하고, 아무것도 만들지 않는다", async () => {
    planGeneration.mockResolvedValue({
      id: 5,
      kind: "edit",
      request: "검색은 어디서 해?",
      style: "",
      summary: "",
      answer: "검색은 search.js가 해요.\n\n영화 목록에서 제목을 찾아요.",
      plan: [],
      files_done: [],
      status: "answered",
      check_summary: "",
      check_fixed: [],
      charged_krw: 3,
      error: "",
      version_number: null,
      created_at: "2026-10-19T00:00:00Z",
      estimated_krw: null,
      max_call_krw: null,
    });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    const box = await screen.findByLabelText("Claude에게 만들거나 고쳐 달라고 하기");
    await user.type(box, "검색은 어디서 해?");
    await user.click(screen.getByRole("button", { name: "고치기" }));

    expect(await screen.findByText(/검색은 search\.js가 해요\./)).toBeTruthy();
    expect(runGeneration).not.toHaveBeenCalled();
    expect(screen.queryByTestId("plan-card")).toBeNull();
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  test("builder-answer-only: 바꾸자는 계획이 있으면 답과 함께 보여 주고, 적용하기를 눌러야 만든다", async () => {
    const suggested = {
      id: 6,
      kind: "edit",
      request: "버튼 색을 바꾸면 어떨까?",
      style: "",
      summary: "버튼 색을 주황색으로 바꿔요.",
      answer: "주황색이 눈에 잘 띄어요.",
      plan: [{ path: "style.css", purpose: "색과 배치" }],
      files_done: [],
      status: "planned",
      check_summary: "",
      check_fixed: [],
      charged_krw: 3,
      error: "",
      version_number: null,
      created_at: "2026-10-19T00:00:00Z",
      estimated_krw: 40,
      max_call_krw: 200,
    };
    planGeneration.mockResolvedValue(suggested);
    runGeneration.mockResolvedValue({ kind: "done", chargedKrw: 49, filesDone: ["style.css"], checkFixed: [] });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.type(await screen.findByLabelText("Claude에게 만들거나 고쳐 달라고 하기"), "버튼 색을 바꾸면 어떨까?");
    await user.click(screen.getByRole("button", { name: "고치기" }));

    const card = await screen.findByTestId("plan-card");
    expect(within(card).getByText("주황색이 눈에 잘 띄어요.")).toBeTruthy();
    expect(within(card).getByText("이렇게 바꿀 수 있어요")).toBeTruthy();
    expect(runGeneration).not.toHaveBeenCalled();

    await user.click(within(card).getByRole("button", { name: /적용하기/ }));
    expect(runGeneration).toHaveBeenCalledWith("7", 6, expect.anything());
  });

  test("builder-answer-only: 괜찮아요를 누르면 계획은 닫히고 답은 대화에 남는다", async () => {
    planGeneration.mockResolvedValue({
      id: 8,
      kind: "edit",
      request: "버튼 색을 바꾸면 어떨까?",
      style: "",
      summary: "버튼 색을 주황색으로 바꿔요.",
      answer: "주황색이 눈에 잘 띄어요.",
      plan: [{ path: "style.css", purpose: "색과 배치" }],
      files_done: [],
      status: "planned",
      check_summary: "",
      check_fixed: [],
      charged_krw: 3,
      error: "",
      version_number: null,
      created_at: "2026-10-19T00:00:00Z",
      estimated_krw: 40,
      max_call_krw: 200,
    });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.type(await screen.findByLabelText("Claude에게 만들거나 고쳐 달라고 하기"), "버튼 색을 바꾸면 어떨까?");
    await user.click(screen.getByRole("button", { name: "고치기" }));
    await user.click(within(await screen.findByTestId("plan-card")).getByRole("button", { name: "괜찮아요" }));

    await waitFor(() => expect(screen.queryByTestId("plan-card")).toBeNull());
    expect(screen.getByText("주황색이 눈에 잘 띄어요.")).toBeTruthy();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  test("불러오기는 확인을 받고, 새 버전을 만들지 않는다고 알린다", async () => {
    listVersions.mockResolvedValue([{ ...V1, number: 2, note: "고치기: 색" }, V1]);
    getHistory.mockResolvedValue(CLEAN);
    restoreVersion.mockResolvedValue({ files: FILES, version: V1, project: PROJECT });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.click(await screen.findByText("저장한 버전 (2)"));
    await user.click(await screen.findByRole("button", { name: "v1 불러오기" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/비용은 들지 않고 새 버전은 만들지 않아요/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "불러오기" }));

    expect(restoreVersion).toHaveBeenCalledWith("7", 1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("저장 안 한 작업이 있으면 불러오기 전에 저장할까요?를 묻는다 — 저장 / 저장 안 함 / 취소", async () => {
    listVersions.mockResolvedValue([{ ...V1, number: 2, note: "저장" }, V1]);
    getHistory.mockResolvedValue(UNSAVED);
    saveVersion.mockResolvedValue({ created: true, version: { ...V1, number: 3 }, project: PROJECT });
    restoreVersion.mockResolvedValue({ files: FILES, version: V1, project: PROJECT });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);
    await user.click(await screen.findByText("저장한 버전 (2)"));

    // 취소: 아무 일도 없다.
    await user.click(await screen.findByRole("button", { name: "v1 불러오기" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("저장 안 한 작업이 있어요. 저장할까요?")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();

    // 저장 안 함: 저장 없이 불러온다.
    await user.click(screen.getByRole("button", { name: "v1 불러오기" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "저장 안 함" }));
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith("7", 1));
    expect(saveVersion).not.toHaveBeenCalled();

    // 저장: 먼저 저장하고 불러온다.
    restoreVersion.mockClear();
    await user.click(await screen.findByRole("button", { name: "v1 불러오기" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith("7", 1));
    expect(saveVersion).toHaveBeenCalledWith("7", "");
  });

  test("버전 저장은 이름을 선택으로 받고, 같으면 이미 같아요라고 말한다", async () => {
    getHistory.mockResolvedValue(CLEAN);
    saveVersion.mockResolvedValue({ created: false, version: { ...V1, number: 2 }, project: PROJECT });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.click(await screen.findByRole("button", { name: /버전 저장/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/버전 이름/), "버튼 색 전");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(saveVersion).toHaveBeenCalledWith("7", "버튼 색 전");
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(expect.stringContaining("이미 같아요")));
  });

  test("실행 취소 / 다시 실행은 이웃한 작업 단계로 간다", async () => {
    getHistory.mockResolvedValue({
      ...CLEAN,
      can_undo: true,
      can_redo: true,
      steps: [
        { seq: 3, note: "a", created_at: "", current: false },
        { seq: 5, note: "b", created_at: "", current: true },
        { seq: 6, note: "c", created_at: "", current: false },
      ],
    });
    restoreStep.mockResolvedValue({ files: FILES, project: PROJECT });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.click(await screen.findByRole("button", { name: "실행 취소" }));
    expect(restoreStep).toHaveBeenLastCalledWith("7", 3);
    await user.click(await screen.findByRole("button", { name: "다시 실행" }));
    expect(restoreStep).toHaveBeenLastCalledWith("7", 6);
  });

  test("저장 안 한 작업이 있을 때 나가면 이 버전을 저장할까요?를 묻는다", async () => {
    getHistory.mockResolvedValue(UNSAVED);
    saveVersion.mockResolvedValue({ created: true, version: { ...V1, number: 3 }, project: PROJECT });
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    await user.click(await screen.findByRole("link", { name: /Project Builder/ }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("이 버전을 저장할까요?")).toBeTruthy();
    expect(routerPush).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(routerPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: /Project Builder/ }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "저장 안 함" }));
    expect(routerPush).toHaveBeenCalledWith("/builder");
    expect(saveVersion).not.toHaveBeenCalled();
  });

  test("깨끗하면 묻지 않고 그냥 나간다", async () => {
    getHistory.mockResolvedValue(CLEAN);
    const user = userEvent.setup();
    render(<BuilderWorkspace projectId="7" />);

    const link = await screen.findByRole("link", { name: /Project Builder/ });
    await user.click(link);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
