/**
 * 미리보기가 버전의 사실을 보여 주는지.
 *
 * 테스트에서 찾은 세 가지를 고정합니다.
 *
 *   1. 16:9를 고르면 재생 틀이 미리보기 칸을 넘어 양옆 패널을 덮었습니다.
 *   2. 설정에는 "Auto — 추천"이라고 적혀 있는데 미리보기 머리글에는
 *      `kling-3.0-pro`라는 날 id가 떠 있었습니다.
 *   3. 10초로 만든 버전이 0:15로 재생됐습니다.
 *
 * 넘침은 **jsdom에서 증명할 수 없습니다** — 레이아웃 엔진이 없어 모든
 * 상자의 크기가 0입니다. 그래서 여기서는 크기를 정하는 *재료*가 맞게
 * 들어가는지만 봅니다: 재생 틀이 레터박스 칸 안에 있고, 비율이 고른
 * 값대로 `--player-ar`로 전달되는지. 실제로 넘치지 않는지는 브라우저에서
 * 세 가지 너비로 확인했고, 그 방법은 docs/BACKLOG.md에 적어 두었습니다.
 *
 * 길이와 모델 이름은 순수한 계산이므로 여기서 제대로 증명됩니다.
 */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { VideoModel, VideoProjectDetail, VideoVersion } from "@/lib/projects";

const KLING: VideoModel = {
  id: 1,
  provider: "higgsfield",
  model_id: "kling-3.0-pro",
  display_name: "Kling 3.0 Pro",
  description: "인물과 움직임 표현이 안정적입니다.",
  sort_order: 10,
  capabilities: {
    durations: [5, 10, 15],
    aspect_ratios: ["9:16", "16:9", "1:1"],
    resolutions: ["720p", "1080p"],
    sound: true,
    supports_edit: true,
    supports_extend: true,
    price_per_second_krw: { "720p": 700, "1080p": 1000 },
    defaults: { duration_seconds: 5, aspect_ratio: "9:16", resolution: "720p", sound: true },
    prices_are_examples: true,
  },
};

/** 10초·16:9로 만든 버전. 화면의 숫자는 전부 여기서 나와야 합니다. */
function version(overrides: Partial<VideoVersion> = {}): VideoVersion {
  return {
    id: 1,
    label: "v1",
    provider: "higgsfield",
    model_id: "kling-3.0-pro",
    provider_job_id: null,
    asset_url: null,
    prompt_snapshot: "비 오는 밤 서울",
    status: "ready",
    has_asset: true,
    created_at: "2026-10-01T10:00:00Z",
    duration_seconds: 10,
    aspect_ratio: "16:9",
    sound: true,
    resolution: "720p",
    auto_selected: true,
    kind: "generate",
    source_version_id: null,
    instruction: null,
    ...overrides,
  };
}

function project(versions: VideoVersion[]): VideoProjectDetail {
  return {
    id: 3,
    name: "프로젝트1",
    prompt: "비 오는 밤 서울",
    status: "draft",
    selected_model_id: null,
    final_version_id: null,
    final_version_has_asset: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    versions,
    selected_model: null,
  };
}

const getVideoProject = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getVideoProject: (...args: unknown[]) => getVideoProject(...args),
    listVideoModels: vi.fn().mockResolvedValue([KLING]),
    listVideoProjects: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ quarter: null, loading: false, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

// CSS 모듈은 jsdom에서 이름만 돌려 줍니다. 클래스 이름으로 찾을 수 있게
// 키를 그대로 값으로 씁니다.
vi.mock("@/app/components/workspace.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("@/app/video/[projectId]/workspace.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

const { default: VideoWorkspace } = await import("@/app/video/[projectId]/VideoWorkspace");

beforeEach(() => {
  vi.clearAllMocks();
});

/** 그려진 재생 틀. 클래스 이름으로 찾습니다. */
function playerEl(): HTMLElement {
  const el = document.querySelector(".player");
  if (!el) throw new Error("재생 틀을 찾지 못했습니다");
  return el as HTMLElement;
}

describe("미리보기 재생 틀", () => {
  test.each([
    ["16:9", "16 / 9"],
    ["9:16", "9 / 16"],
    ["1:1", "1 / 1"],
  ])("%s 버전은 레터박스 칸 안에 그 비율로 들어간다", async (aspect, ratio) => {
    getVideoProject.mockResolvedValue(project([version({ aspect_ratio: aspect })]));

    render(<VideoWorkspace projectId="3" />);
    await waitFor(() => playerEl());

    const player = playerEl();

    // 1. 재생 틀은 레터박스 칸 안에 있습니다. 칸이 남는 자리를 채우고,
    //    영상은 그 안에서만 커집니다 — 이것이 양옆 패널을 덮지 않는 이유입니다.
    expect(player.parentElement?.className).toContain("playerFrame");

    // 2. 비율은 고른 값 그대로 전달됩니다. CSS가 이 값으로 너비를
    //    "칸의 너비"와 "칸의 높이 × 비율" 중 작은 쪽으로 정합니다.
    expect(player.style.getPropertyValue("--player-ar")).toBe(ratio);
  });

  test("버전이 들고 있는 비율이 지금 고른 비율보다 우선한다", async () => {
    // 9:16으로 만든 버전을 보고 있으면, 왼쪽 설정이 무엇이든 미리보기는
    // 그 버전의 비율로 그려져야 합니다.
    getVideoProject.mockResolvedValue(project([version({ aspect_ratio: "9:16" })]));

    render(<VideoWorkspace projectId="3" />);
    await waitFor(() => playerEl());

    expect(playerEl().style.getPropertyValue("--player-ar")).toBe("9 / 16");
  });
});

describe("길이", () => {
  test("10초로 만든 버전은 0:10으로 재생된다", async () => {
    getVideoProject.mockResolvedValue(project([version({ duration_seconds: 10 })]));

    render(<VideoWorkspace projectId="3" />);

    // 예전에는 PREVIEW_SECONDS가 15로 박혀 있어 항상 0:15였습니다.
    await waitFor(() => expect(screen.getByText("0:00 / 0:10")).toBeDefined());
    expect(screen.queryByText("0:00 / 0:15")).toBeNull();
  });

  test("5초 버전은 0:05", async () => {
    getVideoProject.mockResolvedValue(project([version({ duration_seconds: 5 })]));

    render(<VideoWorkspace projectId="3" />);

    await waitFor(() => expect(screen.getByText("0:00 / 0:05")).toBeDefined());
  });

  test("길이를 모르는 옛 버전은 지금 고른 값으로 메우지 않는다", async () => {
    // 칸이 생기기 전에 만들어진 버전입니다. 알 수 없는 것을 아는 척하지
    // 않고 기본값으로 재생합니다.
    getVideoProject.mockResolvedValue(project([version({ duration_seconds: null })]));

    render(<VideoWorkspace projectId="3" />);

    await waitFor(() => expect(screen.getByText("0:00 / 0:15")).toBeDefined());
  });
});

describe("모델 이름", () => {
  test("Auto로 만든 버전은 무엇으로 이어졌는지까지 보여 준다", async () => {
    getVideoProject.mockResolvedValue(project([version({ auto_selected: true })]));

    render(<VideoWorkspace projectId="3" />);

    await waitFor(() => expect(screen.getAllByText("Auto → Kling 3.0 Pro").length).toBeGreaterThan(0));
    // provider의 날 id는 어디에도 보이지 않습니다.
    expect(screen.queryByText("kling-3.0-pro")).toBeNull();
  });

  test("직접 고른 모델은 이름만 보여 준다", async () => {
    getVideoProject.mockResolvedValue(project([version({ auto_selected: false })]));

    render(<VideoWorkspace projectId="3" />);

    await waitFor(() => expect(screen.getAllByText("Kling 3.0 Pro").length).toBeGreaterThan(0));
    expect(screen.queryByText("Auto → Kling 3.0 Pro")).toBeNull();
  });

  test("목록에 없는 모델이라도 날 id를 그대로 띄우지 않는다", async () => {
    // 관리자가 모델을 목록에서 내리면 지난 버전이 가리키는 모델이 목록에
    // 없을 수 있습니다. 그래도 읽을 수 있는 이름으로 보여 줍니다.
    getVideoProject.mockResolvedValue(
      project([version({ model_id: "wan-3.0", auto_selected: false })]),
    );

    render(<VideoWorkspace projectId="3" />);

    await waitFor(() => expect(screen.getAllByText("Wan 3.0").length).toBeGreaterThan(0));
    expect(screen.queryByText("wan-3.0")).toBeNull();
  });
});

describe("다운로드", () => {
  test("미리보기 머리글의 다운로드는 지금 보이는 버전을 받는다 — 최종본이 아니어도", async () => {
    getVideoProject.mockResolvedValue(
      project([version({ id: 7, label: "v1" }), version({ id: 8, label: "v2" })]),
    );

    render(<VideoWorkspace projectId="3" />);
    await waitFor(() => playerEl());

    // 아무것도 최종본이 아니면 가장 최근 버전(v2)이 보입니다.
    const header = screen.getByRole("link", { name: "다운로드" });
    expect(header.getAttribute("href")).toBe("/api/video/projects/3/versions/8/download");
    expect(header.hasAttribute("download")).toBe(true);
  });

  test("버전 줄의 조각마다 자기 버전을 받는 다운로드가 있다", async () => {
    getVideoProject.mockResolvedValue(
      project([version({ id: 7, label: "v1" }), version({ id: 8, label: "v2" })]),
    );

    render(<VideoWorkspace projectId="3" />);
    await waitFor(() => playerEl());

    expect(screen.getByRole("link", { name: "v1 다운로드" }).getAttribute("href")).toBe(
      "/api/video/projects/3/versions/7/download",
    );
    expect(screen.getByRole("link", { name: "v2 다운로드" }).getAttribute("href")).toBe(
      "/api/video/projects/3/versions/8/download",
    );
  });

  test("파일이 없는 이전 버전은 흐린 단추와 이유, 링크는 없다", async () => {
    // 파일을 보관하기 전에 만든 버전입니다. 뒤늦게 만들어 주지 않습니다.
    getVideoProject.mockResolvedValue(
      project([version({ id: 7, label: "v1", has_asset: false })]),
    );

    render(<VideoWorkspace projectId="3" />);
    await waitFor(() => playerEl());

    expect(screen.queryByRole("link", { name: /다운로드/ })).toBeNull();
    const chip = screen.getByRole("button", { name: "v1 다운로드" });
    const header = screen.getByRole("button", { name: "다운로드" });
    for (const button of [chip, header]) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.getAttribute("title")).toBe("파일이 없는 이전 버전입니다");
    }
  });
});

describe("Claude 칸", () => {
  test("새 프로젝트는 예시 대화 없이 시작한다", async () => {
    getVideoProject.mockResolvedValue(project([]));

    render(<VideoWorkspace projectId="3" />);

    // 접혀서 시작하므로 먼저 엽니다.
    const open = await screen.findByRole("button", { name: "프롬프트 도움받기 (선택)" });
    act(() => open.click());
    await waitFor(() => expect(screen.getByText(/바꾸고 싶은 것을 한국어로 적으면/)).toBeDefined());
    // 예전에 미리 들어 있던 예시 대화.
    expect(screen.queryByText(/조금 더 어두운 분위기로 바꿔줘/)).toBeNull();
  });
});

describe("버전 조각", () => {
  test("조각은 그 버전의 길이·비율·모델을 보여 준다", async () => {
    getVideoProject.mockResolvedValue(
      project([version({ duration_seconds: 10, aspect_ratio: "16:9" })]),
    );

    render(<VideoWorkspace projectId="3" />);

    const list = await waitFor(() => {
      const el = document.querySelector(".versionList");
      if (!el) throw new Error("버전 목록을 찾지 못했습니다");
      return el as HTMLElement;
    });

    expect(within(list).getByText("10초 · 16:9 · 720p")).toBeDefined();
    expect(within(list).getByText("Auto → Kling 3.0 Pro")).toBeDefined();
  });
});
