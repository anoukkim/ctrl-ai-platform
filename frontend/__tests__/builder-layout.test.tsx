/**
 * quality-tuning Q3 — Builder 화면 배치.
 *
 * 위쪽 막대(GitHub 숨김, 내보내기 ▾, ⋯ 안의 게시 취소, 같은 버전이면 할 일
 * 없는 업데이트 게시), 코드 / 미리보기 두 탭과 기억, 접히는 판, 안내 문서
 * 폴더, 코드 보기(줄 바꿈 · 복사 · .md 펼치기), Claude 판의 이 버전 보기,
 * Enter로 보내기.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { forgetPrefsInMemory } from "@/lib/layout-prefs";
import type { BuilderFile, BuilderHistory, BuilderProject, BuilderVersion } from "@/lib/projects";

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

const LONG_LINE = `const greeting = "${"안녕하세요 ".repeat(40)}";`;

const FILES: BuilderFile[] = [
  { path: "index.html", content: "<!doctype html><h1>할 일</h1>", updated_at: "" },
  { path: "app.js", content: `${LONG_LINE}\nconsole.log(greeting);`, updated_at: "" },
  { path: "README.md", content: "# 할 일 앱\n\n- 추가\n- 완료", updated_at: "" },
  { path: "HANDOFF_PROMPT.md", content: "이 앱을 이어서 만들어 줘", updated_at: "" },
];

const V1: BuilderVersion = {
  number: 1,
  note: "만들기: 할 일 앱",
  created_at: "2026-10-14T09:00:00Z",
  file_count: 4,
  total_bytes: 200,
  request: "할 일 앱",
  summary: "할 일 앱을 파일 3개로 만들었어요.",
  changed_count: 3,
  charged_krw: 180,
};

const V2: BuilderVersion = {
  ...V1,
  number: 2,
  note: "고치기: 다크 모드",
  request: "다크 모드 버튼 만들어 줘",
  summary: "다크 모드 버튼을 넣었어요.",
  changed_count: 2,
  charged_krw: 31,
};

let project: BuilderProject = PROJECT;
let githubEnabled = false;
const planGeneration = vi.fn();
const getVersionFiles = vi.fn();
let versions: BuilderVersion[] = [V2, V1];
/** builder-snapshots: the 작업 steps the Claude panel shows, one per version here. */
const unsaved = false;
const historyOf = (): BuilderHistory => ({
  steps: [...versions].reverse().map((version, index, all) => ({
    seq: version.number,
    note: version.note,
    created_at: version.created_at,
    current: index === all.length - 1,
    request: version.request,
    summary: version.summary,
    changed_count: version.changed_count,
    charged_krw: version.charged_krw,
  })),
  can_undo: versions.length > 1,
  can_redo: false,
  unsaved,
  reference_version_number: versions[0]?.number ?? null,
  latest_version_number: versions[0]?.number ?? null,
});
const unpublishProject = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getBuilderProject: vi.fn(async () => project),
    listBuilderProjects: vi.fn().mockResolvedValue([]),
    listBuilderFiles: vi.fn(async () => FILES),
    listVersions: vi.fn(async () => versions),
    getHistory: vi.fn(async () => historyOf()),
    getVersionFiles: (...args: unknown[]) => getVersionFiles(...args),
    unpublishProject: (...args: unknown[]) => unpublishProject(...args),
    getGenerateEstimate: vi.fn().mockResolvedValue({
      estimated_krw: 70,
      worst_case_krw: 240,
      model_label: "Sonnet 5.5",
      max_output_tokens: 16000,
    }),
  };
});

vi.mock("@/lib/generation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation")>();
  return {
    ...actual,
    getOpenGeneration: vi.fn().mockResolvedValue(null),
    planGeneration: (...args: unknown[]) => planGeneration(...args),
    cancelGeneration: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("@/app/components/SiteProvider", () => ({
  useSite: () => ({ apps_base_url: "http://apps.test", github_enabled: githubEnabled, test_mode: { builder: false } }),
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
  window.localStorage.clear();
  forgetPrefsInMemory();
  project = PROJECT;
  githubEnabled = false;
  planGeneration.mockReturnValue(new Promise(() => {}));
});

async function ready() {
  render(<BuilderWorkspace projectId="7" />);
  await screen.findByRole("tab", { name: "미리보기" });
  await screen.findByTestId("file-count");
}

describe("위쪽 막대", () => {
  test("GitHub은 Phase 4 전까지 배지도 단추도 없다", async () => {
    await ready();
    expect(screen.queryByText("GitHub 미연결")).toBeNull();
    expect(screen.queryByRole("button", { name: "GitHub에 저장" })).toBeNull();
  });

  test("GitHub이 켜진 배포에서는 배지가 보인다", async () => {
    githubEnabled = true;
    await ready();
    expect(screen.getByText("GitHub 미연결")).toBeTruthy();
  });

  test("내려받기와 내 Claude로 이어서 만들기는 내보내기 메뉴 하나에", async () => {
    const user = userEvent.setup();
    await ready();
    expect(screen.queryByRole("button", { name: "내려받기" })).toBeNull();

    const exportButton = screen.getByRole("button", { name: "내보내기 ▾" });
    expect(exportButton.getAttribute("aria-haspopup")).toBe("menu");
    await user.click(exportButton);
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("내려받기"),
      expect.stringContaining("내 Claude로 이어서 만들기"),
    ]);
    // 키보드: 열리면 첫 항목, ↓로 다음, Esc면 닫히고 단추로 돌아갑니다.
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(exportButton);

    await user.click(exportButton);
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /내려받기/ }));
    expect(await screen.findByRole("dialog", { name: "프로젝트 내려받기" })).toBeTruthy();
  });

  test("게시 취소는 ⋯ 안에, 확인을 거친다", async () => {
    project = { ...PROJECT, app_slug: "pub1234567", published_version_number: 1 };
    const user = userEvent.setup();
    await ready();
    expect(screen.queryByRole("button", { name: "게시 취소" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "게시 메뉴 더 보기" }));
    await user.click(screen.getByRole("menuitem", { name: /게시 취소/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/만든 파일과 버전 기록은 모두 남고/)).toBeTruthy();
    expect(unpublishProject).not.toHaveBeenCalled();
  });

  test("작업 중 버전이 게시된 버전과 같으면 업데이트 게시는 할 일이 없다고 말한다", async () => {
    project = { ...PROJECT, app_slug: "pub1234567", published_version_number: 2 };
    const user = userEvent.setup();
    await ready();

    await waitFor(() =>
      expect(screen.getByTestId("version-status").textContent).toBe("게시됨 v2 · 게시된 버전과 같아요"),
    );
    const update = screen.getByRole("button", { name: "업데이트 게시" });
    expect(update.getAttribute("aria-disabled")).toBe("true");
    expect(update.getAttribute("title")).toContain("게시된 버전과 같아요");
    await user.click(update);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("탭과 판", () => {
  test("탭은 코드 / 미리보기 둘뿐이고, 파일이 있으면 미리보기로 연다", async () => {
    await ready();
    const tabs = within(screen.getByRole("tablist", { name: "보기" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["코드", "미리보기"]);
    expect(screen.getByRole("tab", { name: "미리보기" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "나란히" })).toBeNull();
  });

  test("마지막 탭을 프로젝트마다 기억하고, ←→로도 바꾼다", async () => {
    const user = userEvent.setup();
    const first = render(<BuilderWorkspace projectId="7" />);
    await user.click(await screen.findByRole("tab", { name: "코드" }));
    expect(window.localStorage.getItem("ctrlai.builder.tab.7")).toBe("code");
    first.unmount();
    forgetPrefsInMemory(); // 페이지를 새로 연 것처럼 — 저장소에서 읽어야 합니다.

    render(<BuilderWorkspace projectId="7" />);
    const code = await screen.findByRole("tab", { name: "코드" });
    await waitFor(() => expect(code.getAttribute("aria-selected")).toBe("true"));
    code.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "미리보기" }).getAttribute("aria-selected")).toBe("true");
  });

  test("파일 목록과 Claude 판을 접고 다시 열고, 접은 것을 기억한다", async () => {
    const user = userEvent.setup();
    await ready();

    await user.click(screen.getByRole("button", { name: "파일 목록 접기" }));
    expect(screen.queryByRole("complementary", { name: "파일" })).toBeNull();
    expect(window.localStorage.getItem("ctrlai.builder.files-hidden")).toBe("1");
    await user.click(screen.getByRole("button", { name: "Claude 판 접기" }));
    expect(screen.queryByRole("complementary", { name: "Claude" })).toBeNull();

    // 접은 Claude 판은 미리보기 도구 줄의 "Claude"로 다시 엽니다.
    const toolbar = screen.getByRole("toolbar", { name: "미리보기 도구" });
    await user.click(within(toolbar).getByRole("button", { name: "Claude 판 열기" }));
    expect(screen.getByRole("complementary", { name: "Claude" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "파일 목록 열기" }));
    expect(screen.getByRole("complementary", { name: "파일" })).toBeTruthy();
    expect(window.localStorage.getItem("ctrlai.builder.files-hidden")).toBe("0");
  });

  test("안내 문서는 접힌 폴더에 따로, 개수도 따로 센다", async () => {
    const user = userEvent.setup();
    await ready();
    expect(screen.getByTestId("file-count").textContent).toBe("파일 2개 · 안내 문서 2개");

    const files = screen.getByRole("complementary", { name: "파일" });
    expect(within(files).getByRole("button", { name: "app.js" })).toBeTruthy();
    expect(within(files).queryByRole("button", { name: "README.md" })).toBeNull();
    const folder = within(files).getByRole("button", { name: /안내 문서/ });
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    await user.click(folder);
    expect(within(files).getByRole("button", { name: "README.md" })).toBeTruthy();
  });
});

describe("미리보기 도구 줄", () => {
  test("아이콘 단추마다 이름이 있고, 안전 안내는 한 줄 + ⓘ", async () => {
    const user = userEvent.setup();
    await ready();
    const toolbar = screen.getByRole("toolbar", { name: "미리보기 도구" });
    for (const name of ["새로 고침", "새 창에서 열기", "미리보기 갱신", "크게 보기"]) {
      expect(within(toolbar).getAllByRole(name === "새 창에서 열기" ? "link" : "button", { name }).length).toBe(1);
    }
    expect(within(toolbar).getByLabelText("미리볼 버전")).toBeTruthy();

    expect(screen.getByText("앱은 CTRL+AI 계정과 분리된 칸에서 돌아가요.")).toBeTruthy();
    expect(screen.queryByText(/비밀번호나 개인 정보를 입력하지 마세요/)).toBeNull();
    const info = screen.getByRole("button", { name: "안전 안내 자세히" });
    await user.click(info);
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/비밀번호나 개인 정보를 입력하지 마세요/)).toBeTruthy();
  });
});

describe("코드 보기", () => {
  test("코드는 줄 바꿈 끔으로 열고, 켜면 줄 번호가 줄마다 붙어 있다", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(within(screen.getByRole("complementary", { name: "파일" })).getByRole("button", { name: "app.js" }));

    expect(screen.getByRole("tab", { name: "코드" }).getAttribute("aria-selected")).toBe("true");
    const wrap = screen.getByRole("switch", { name: /줄 바꿈/ });
    expect(wrap.getAttribute("aria-checked")).toBe("false");
    await user.click(wrap);
    expect(wrap.getAttribute("aria-checked")).toBe("true");

    const lines = screen.getByTestId("code-lines");
    const rows = Array.from(lines.children);
    expect(rows).toHaveLength(2);
    expect(rows[0].firstElementChild!.textContent).toBe("1");
    expect(rows[0].textContent).toContain("안녕하세요");
    expect(rows[1].firstElementChild!.textContent).toBe("2");
    expect(screen.getByRole("button", { name: "app.js 복사" })).toBeTruthy();
  });

  test(".md는 펼쳐서 보여 주고, 원문 보기로 글자 그대로", async () => {
    const user = userEvent.setup();
    await ready();
    const files = screen.getByRole("complementary", { name: "파일" });
    await user.click(within(files).getByRole("button", { name: /안내 문서/ }));
    await user.click(within(files).getByRole("button", { name: "README.md" }));

    const rendered = screen.getByTestId("code-markdown");
    expect(within(rendered).getByRole("heading", { name: "할 일 앱" })).toBeTruthy();
    expect(within(rendered).getAllByRole("listitem")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "원문 보기" }));
    expect(screen.queryByTestId("code-markdown")).toBeNull();
    expect(screen.getByTestId("code-lines").textContent).toContain("# 할 일 앱");
    // 글로 읽는 파일은 줄 바꿈 켬이 기본입니다.
    expect(screen.getByRole("switch", { name: /줄 바꿈/ }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("Claude 판", () => {
  test("가져온 버전만 있으면 대화 기록 없이 모든 버전만, 열린 채로 (owner-polish 13)", async () => {
    /**
     * Every version came from 예시 앱 / 가져오기 (no request behind it). The
     * history would repeat 모든 버전 row for row, so it stays away until the
     * first 만들기/고치기; 이 버전 보기 moves onto the list meanwhile.
     */
    versions = [
      { ...V2, request: "", summary: "", changed_count: null, charged_krw: null, note: "예시 앱" },
      { ...V1, request: "", summary: "", changed_count: null, charged_krw: null, note: "예시 앱" },
    ];
    getVersionFiles.mockResolvedValue([{ path: "index.html", content: "<h1>예전</h1>" }]);
    const user = userEvent.setup();
    await ready();

    expect(screen.queryByRole("list", { name: "바뀌어 온 기록" })).toBeNull();
    const all = screen.getByTestId("all-versions") as HTMLDetailsElement;
    expect(all.open).toBe(true);
    expect(screen.getAllByText("예시 앱")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "v1 이 버전 보기" }));
    expect(getVersionFiles).toHaveBeenCalledWith("7", 1);
    versions = [V2, V1];
  });

  test("고친 기록이 대화로, 지난 버전은 이 버전 보기로 미리본다", async () => {
    getVersionFiles.mockResolvedValue([{ path: "index.html", content: "<h1>예전</h1>" }]);
    const user = userEvent.setup();
    const { container } = render(<BuilderWorkspace projectId="7" />);

    const history = await screen.findByRole("list", { name: "바뀌어 온 기록" });
    expect(await within(history).findByText("다크 모드 버튼 만들어 줘")).toBeTruthy();
    expect(within(history).getByText("파일 2개 바뀜 · 31원")).toBeTruthy();
    expect(within(history).getByText("파일 3개 바뀜 · 180원")).toBeTruthy();

    // 이 버전 보기는 저장한 버전 목록에 있습니다(작업 단계는 "이 단계로").
    await user.click(await screen.findByText("저장한 버전 (2)"));
    await user.click(screen.getByRole("button", { name: "v1 이 버전 보기" }));
    expect(getVersionFiles).toHaveBeenCalledWith("7", 1);
    expect(await screen.findByText(/v1을\(를\) 보는 중이에요/)).toBeTruthy();
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("srcdoc")).toContain("예전");

    await user.click(screen.getByRole("button", { name: "작업 중 버전으로" }));
    await waitFor(() => expect(container.querySelector("iframe")!.getAttribute("src")).toContain("/k3m9qx7pwa/"));
  });

  test("Enter는 보내고 Shift+Enter는 줄을 바꾼다", async () => {
    const user = userEvent.setup();
    await ready();
    const field = screen.getByLabelText("Claude에게 만들거나 고쳐 달라고 하기");
    expect(field.getAttribute("placeholder")).toMatch(/^예: /);

    await user.type(field, "글씨를 키워 줘{Shift>}{Enter}{/Shift}제목만");
    expect((field as HTMLTextAreaElement).value).toBe("글씨를 키워 줘\n제목만");
    expect(planGeneration).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(planGeneration).toHaveBeenCalledWith("7", { request: "글씨를 키워 줘\n제목만" });
    // 비용은 고치기 옆에 그대로 보입니다.
    expect(screen.getByText(/약 70원 · 최대 240원/)).toBeTruthy();
  });
});
