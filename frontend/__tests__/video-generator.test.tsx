/**
 * Video 작업 공간이 모델의 카탈로그를 따르는지 — video-higgsfield-only.
 *
 *   - 고른 모델이 주는 선택지만 보인다(길이·비율·화질·소리).
 *   - 모델을 바꾸면 남길 것은 남기고 나머지는 기본값으로, 한 줄로 알린다.
 *   - 예상 비용은 카탈로그 가격으로 계산되고 설정을 바꾸면 따라 바뀐다.
 *   - 수정·이어서 만들기는 지원하는 모델에서만 보이고, 수정 모드에서는
 *     길이·비율 조작부가 사라진다.
 *   - Claude 칸은 접혀서 시작하고, 영상을 만드는 호출을 하지 않는다.
 *
 * 백엔드는 부르지 않습니다. lib/projects의 호출을 가짜로 바꿔 둡니다.
 */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { VideoModel, VideoProjectDetail, VideoVersion } from "@/lib/projects";

const KLING: VideoModel = {
  id: 1,
  provider: "higgsfield",
  model_id: "kling-3.0-pro",
  display_name: "Kling 3.0 Pro",
  description: "",
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

const SEEDANCE: VideoModel = {
  id: 2,
  provider: "higgsfield",
  model_id: "seedance-2.0",
  display_name: "Seedance 2.0",
  description: "",
  sort_order: 20,
  capabilities: {
    durations: [5, 10],
    aspect_ratios: ["9:16"],
    resolutions: ["480p", "720p"],
    sound: false,
    supports_edit: false,
    supports_extend: true,
    price_per_second_krw: { "480p": 300, "720p": 500 },
    defaults: { duration_seconds: 5, aspect_ratio: "9:16", resolution: "480p", sound: false },
    prices_are_examples: true,
  },
};

function version(overrides: Partial<VideoVersion> = {}): VideoVersion {
  return {
    id: 11,
    label: "v1",
    provider: "higgsfield",
    model_id: "kling-3.0-pro",
    provider_job_id: "mock-generate-1",
    asset_url: null,
    prompt_snapshot: "비 오는 밤 서울",
    status: "ready",
    has_asset: true,
    created_at: "2026-10-07T10:00:00Z",
    duration_seconds: 10,
    aspect_ratio: "9:16",
    resolution: "720p",
    sound: true,
    auto_selected: false,
    kind: "generate",
    source_version_id: null,
    instruction: null,
    ...overrides,
  };
}

function project(model: VideoModel | null, versions: VideoVersion[] = []): VideoProjectDetail {
  return {
    id: 3,
    name: "밤의 서울",
    prompt: "비 오는 밤 서울",
    status: "draft",
    selected_model_id: model?.id ?? null,
    final_version_id: null,
    final_version_has_asset: false,
    created_at: "2026-10-07T00:00:00Z",
    updated_at: "2026-10-07T00:00:00Z",
    versions,
    selected_model: model,
  };
}

const api = {
  getVideoProject: vi.fn(),
  updateVideoProject: vi.fn(),
  createVideoVersion: vi.fn(),
  editVideoVersion: vi.fn(),
  extendVideoVersion: vi.fn(),
  askPromptHelp: vi.fn(),
};

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getVideoProject: (...args: unknown[]) => api.getVideoProject(...args),
    updateVideoProject: (...args: unknown[]) => api.updateVideoProject(...args),
    createVideoVersion: (...args: unknown[]) => api.createVideoVersion(...args),
    editVideoVersion: (...args: unknown[]) => api.editVideoVersion(...args),
    extendVideoVersion: (...args: unknown[]) => api.extendVideoVersion(...args),
    askPromptHelp: (...args: unknown[]) => api.askPromptHelp(...args),
    listVideoModels: vi.fn().mockResolvedValue([KLING, SEEDANCE]),
    listVideoProjects: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ quarter: null, loading: false, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

/** 설정 한 줄(길이·비율·화질)의 단추 이름들. */
function optionsIn(label: string): string[] {
  const group = screen.getByRole("group", { name: label });
  return within(group)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

async function open(detail: VideoProjectDetail) {
  api.getVideoProject.mockResolvedValue(detail);
  render(<VideoWorkspace projectId="3" />);
  await screen.findByRole("group", { name: "길이" });
}

describe("모델이 주는 선택지만 보인다", () => {
  test("Kling: 세 길이, 세 비율, 두 화질, 소리", async () => {
    await open(project(KLING));

    expect(optionsIn("길이")).toEqual(["5초", "10초", "15초"]);
    expect(optionsIn("비율")).toHaveLength(3);
    expect(optionsIn("화질")).toEqual(["720p", "1080p"]);
    expect(screen.getByRole("button", { name: /소리 켬/ })).toBeDefined();
  });

  test("Seedance: 없는 선택지는 흐리게가 아니라 아예 없다", async () => {
    await open(project(SEEDANCE));

    expect(optionsIn("길이")).toEqual(["5초", "10초"]);
    expect(optionsIn("비율")).toEqual(["9:16 세로"]);
    expect(optionsIn("화질")).toEqual(["480p", "720p"]);
    // 소리를 지원하지 않으니 소리 줄이 없습니다.
    expect(screen.queryByRole("button", { name: /소리 켬|소리 끔/ })).toBeNull();
  });

  test("모델의 기본값이 미리 골라져 있다", async () => {
    await open(project(SEEDANCE));

    const pressed = within(screen.getByRole("group", { name: "화질" })).getByRole("button", {
      pressed: true,
    });
    expect(pressed.textContent).toBe("480p");
  });
});

describe("예상 비용", () => {
  test("길이 × 그 화질의 초당 가격으로, 설정을 따라 바뀐다", async () => {
    const user = userEvent.setup();
    await open(project(KLING));

    const cost = screen.getByTestId("generate-cost");
    expect(cost.textContent).toBe("예상 3,500원"); // 5초 × 700원

    await user.click(within(screen.getByRole("group", { name: "길이" })).getByText("10초"));
    await user.click(within(screen.getByRole("group", { name: "화질" })).getByText("1080p"));

    expect(cost.textContent).toBe("예상 10,000원"); // 10초 × 1,000원
    expect(screen.getByTestId("video-summary").textContent).toContain("1080p");
  });

  test("생성 요청에는 고른 설정이 화질까지 그대로 실린다", async () => {
    const user = userEvent.setup();
    api.updateVideoProject.mockResolvedValue(project(KLING));
    api.createVideoVersion.mockResolvedValue(version({ id: 12 }));
    await open(project(KLING));

    await user.click(screen.getByRole("button", { name: /Higgsfield로 생성/ }));

    await waitFor(() => expect(api.createVideoVersion).toHaveBeenCalled());
    expect(api.createVideoVersion).toHaveBeenCalledWith("3", {
      duration_seconds: 5,
      aspect_ratio: "9:16",
      resolution: "720p",
      sound: true,
    });
  });

  test("지원금이 모자라면 화면을 덮지 않고 버튼 아래에 이유를 적는다", async () => {
    const user = userEvent.setup();
    api.updateVideoProject.mockResolvedValue(project(KLING));
    api.createVideoVersion.mockRejectedValue(new ApiError("이번 분기 지원금이 부족합니다.", 402));
    await open(project(KLING));

    await user.click(screen.getByRole("button", { name: /Higgsfield로 생성/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("지원금이 부족합니다");
    expect(screen.getByRole("group", { name: "길이" })).toBeDefined();
  });
});

describe("모델 바꾸기", () => {
  test("없는 선택은 기본값으로 바꾸고 무엇을 바꿨는지 알린다", async () => {
    const user = userEvent.setup();
    api.updateVideoProject.mockResolvedValue(project(SEEDANCE));
    await open(project(KLING));

    await user.click(within(screen.getByRole("group", { name: "길이" })).getByText("10초"));
    await user.click(within(screen.getByRole("group", { name: "화질" })).getByText("1080p"));
    // 모델은 라디오 카드입니다 — 예전 <select>와 같은 값(모델 id)을 보냅니다.
    await user.click(screen.getByRole("radio", { name: /Seedance 2\.0/ }));

    const notice = await screen.findByRole("status");
    // 10초는 Seedance에도 있어 남고, 1080p와 소리는 바뀝니다.
    expect(notice.textContent).toBe("이 모델에 맞춰 화질을 480p로, 소리를 끔으로 바꿨습니다.");
    expect(api.updateVideoProject).toHaveBeenCalledWith("3", { selected_model_id: SEEDANCE.id });
    await waitFor(() =>
      expect(screen.getByTestId("generate-cost").textContent).toBe("예상 3,000원"),
    );
  });
});

describe("수정 · 이어서 만들기", () => {
  test("둘 다 지원하는 모델의 버전에는 두 단추가 다 있다", async () => {
    await open(project(KLING, [version()]));

    expect(screen.getByRole("button", { name: /이 영상 수정하기/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /이어서 만들기/ })).toBeDefined();
  });

  test("수정을 지원하지 않는 모델은 단추 대신 짧은 안내", async () => {
    await open(project(SEEDANCE, [version({ model_id: "seedance-2.0", resolution: "480p" })]));

    expect(screen.queryByRole("button", { name: /이 영상 수정하기/ })).toBeNull();
    expect(screen.getByRole("button", { name: /이어서 만들기/ })).toBeDefined();
    expect(screen.getByText("Seedance 2.0 모델은 수정을 지원하지 않습니다.")).toBeDefined();
  });

  test("수정 모드에서는 길이·비율을 고를 수 없고 원본의 값으로 계산한다", async () => {
    const user = userEvent.setup();
    api.editVideoVersion.mockResolvedValue(version({ id: 12, kind: "edit", source_version_id: 11 }));
    await open(project(KLING, [version()]));

    await user.click(screen.getByRole("button", { name: /이 영상 수정하기/ }));

    expect(screen.queryByRole("group", { name: "길이" })).toBeNull();
    expect(screen.queryByRole("group", { name: "비율" })).toBeNull();
    // 원본 10초 × 720p 700원.
    expect(screen.getByTestId("action-cost").textContent).toBe("예상 7,000원");

    await user.type(screen.getByLabelText("수정 요청"), "비를 눈으로");
    const panel = screen.getByRole("region", { name: "v1 수정하기" });
    await user.click(within(panel).getByRole("button", { name: /수정하기/ }));

    await waitFor(() =>
      expect(api.editVideoVersion).toHaveBeenCalledWith("3", 11, "비를 눈으로"),
    );
    expect(api.createVideoVersion).not.toHaveBeenCalled();
  });

  test("이어서 만들기는 모델의 길이 중에서 고르고, 덧붙인 만큼만 계산한다", async () => {
    const user = userEvent.setup();
    api.extendVideoVersion.mockResolvedValue(version({ id: 12, kind: "extend" }));
    await open(project(KLING, [version()]));

    await user.click(screen.getByRole("button", { name: /이어서 만들기/ }));

    expect(optionsIn("덧붙일 길이")).toEqual(["5초", "10초", "15초"]);
    expect(screen.getByTestId("action-cost").textContent).toBe("예상 3,500원");
    await user.click(within(screen.getByRole("group", { name: "덧붙일 길이" })).getByText("15초"));
    expect(screen.getByTestId("action-cost").textContent).toBe("예상 10,500원");
    expect(screen.getByText("새 길이: 25초")).toBeDefined();

    const panel = screen.getByRole("region", { name: "v1 이어서 만들기" });
    await user.click(within(panel).getByRole("button", { name: /이어서 만들기/ }));
    await waitFor(() => expect(api.extendVideoVersion).toHaveBeenCalledWith("3", 11, 15));
  });

  test("버전 조각은 어떻게, 무엇에서 만들었는지 보여 준다", async () => {
    await open(
      project(KLING, [
        version(),
        version({ id: 12, label: "v2", kind: "edit", source_version_id: 11 }),
      ]),
    );

    expect(screen.getByText("수정 ← v1")).toBeDefined();
    expect(screen.getByText("생성")).toBeDefined();
  });
});

describe("상태 배지", () => {
  test("최종본을 골라도 배지는 Draft — Ready는 회원에게 보이지 않는다", async () => {
    const user = userEvent.setup();
    const chosen = { ...project(KLING, [version()]), final_version_id: 11, status: "ready" as const };
    api.updateVideoProject.mockResolvedValue(chosen);
    await open(project(KLING, [version()]));
    expect(screen.getByText("Draft")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /최종본으로 선택/ }));

    await waitFor(() => expect(api.updateVideoProject).toHaveBeenCalled());
    expect(screen.getByText("Draft")).toBeDefined();
    expect(screen.queryByText("Ready")).toBeNull();
  });
});

describe("프롬프트 도움받기", () => {
  test("접혀서 시작하고, 열면 Build 지원금에서 차감된다고 한 줄로 말한다", async () => {
    await open(project(KLING));

    expect(screen.queryByLabelText("Claude에게 프롬프트 수정 요청하기")).toBeNull();
    act(() => screen.getByRole("button", { name: "프롬프트 도움받기 (선택)" }).click());

    expect(screen.getByText(/Build\(Claude\)\s*지원금에서 차감됩니다/)).toBeDefined();
  });

  test("글만 고치고 영상은 만들지 않는다", async () => {
    const user = userEvent.setup();
    api.askPromptHelp.mockResolvedValue({
      reply: "조명을 낮췄어요.",
      revised_prompt: "비 오는 밤 서울 전체 조명을 더 낮춰줘.",
      charged_krw: 10,
    });
    await open(project(KLING));

    await user.click(screen.getByRole("button", { name: "프롬프트 도움받기 (선택)" }));
    await user.type(screen.getByLabelText("Claude에게 프롬프트 수정 요청하기"), "더 어둡게{Enter}");
    await user.click(await screen.findByRole("button", { name: /수정된 프롬프트 적용/ }));

    expect(api.askPromptHelp).toHaveBeenCalledWith("3", {
      prompt: "비 오는 밤 서울",
      request: "더 어둡게",
    });
    expect(api.createVideoVersion).not.toHaveBeenCalled();
    expect(api.editVideoVersion).not.toHaveBeenCalled();
    expect(api.extendVideoVersion).not.toHaveBeenCalled();
    expect((screen.getByLabelText("영상 프롬프트") as HTMLTextAreaElement).value).toBe(
      "비 오는 밤 서울 전체 조명을 더 낮춰줘.",
    );
  });
});
