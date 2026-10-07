/**
 * 작업 공간이 "불러오는 중"에서 빠져나오는지.
 *
 * fix-video-workspace-hang이 요구한 테스트입니다. `/video/[projectId]`가
 * "영상 프로젝트를 불러오는 중…"에서 영원히 멈추는 버그가 있었습니다.
 * 세 번의 API 호출은 모두 200이었고 콘솔도 깨끗했기 때문에, 눈으로 보는
 * 확인으로는 무엇이 잘못됐는지 알 수 없었습니다.
 *
 * 원인은 불러오기 효과의 뒷정리였습니다. 효과가 두 번 돌면(개발 모드의
 * StrictMode, 또는 작업 공간을 빠르게 갈아탈 때) 첫 실행은 뒷정리에서
 * "밀려났다"고 표시되고, 그 뒤 **멀쩡히 도착한 200 응답이 버려졌습니다**.
 * 뒤에 선 요청이 끝내 도착하지 않으면 화면을 꺼내 줄 것이 남지 않습니다.
 *
 * 그래서 이 테스트는 그 상황을 그대로 만듭니다: 첫 요청은 성공하고,
 * 두 번째 요청은 **영원히 끝나지 않습니다**. 고치기 전에는 멈춘 채로
 * 남고, 고친 뒤에는 첫 응답으로 화면이 열립니다.
 *
 * 백엔드는 부르지 않습니다 — 네트워크를 타면 백엔드가 꺼져 있을 때
 * 실패하고, 그러면 테스트가 무엇을 증명하는지 알 수 없습니다.
 */

import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { BuilderProject, VideoProjectDetail } from "@/lib/projects";

const VIDEO_PROJECT: VideoProjectDetail = {
  id: 3,
  name: "프로젝트1",
  prompt: "비 오는 밤 서울 골목",
  status: "draft",
  selected_model_id: null,
  final_version_id: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  versions: [],
  selected_model: null,
};

const BUILDER_PROJECT: BuilderProject = {
  id: 4,
  name: "가계부",
  description: "",
  status: "draft",
  github_repo: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

/** 절대 끝나지 않는 약속. 두 번째 요청이 돌아오지 않는 상황입니다. */
const NEVER = new Promise<never>(() => {});

const getVideoProject = vi.fn();
const getBuilderProject = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  // 상태 문구표(VIDEO_STATUS_LABEL 등)는 진짜를 그대로 씁니다.
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getVideoProject: (...args: unknown[]) => getVideoProject(...args),
    getBuilderProject: (...args: unknown[]) => getBuilderProject(...args),
    listVideoModels: vi.fn().mockResolvedValue([]),
    listVideoProjects: vi.fn().mockResolvedValue([]),
    listBuilderProjects: vi.fn().mockResolvedValue([]),
  };
});

// 참여 여부는 이 테스트가 묻는 것이 아닙니다. 활동 회원으로 둡니다.
vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ quarter: null, loading: false, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

// CSS 모듈은 jsdom에서 의미가 없어 이름만 돌려 줍니다.
vi.mock("@/app/components/workspace.module.css", () => ({ default: {} }));
vi.mock("@/app/video/[projectId]/workspace.module.css", () => ({ default: {} }));
vi.mock("@/app/builder/[projectId]/workspace.module.css", () => ({ default: {} }));

const { default: VideoWorkspace } = await import("@/app/video/[projectId]/VideoWorkspace");
const { default: BuilderWorkspace } = await import(
  "@/app/builder/[projectId]/BuilderWorkspace"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("작업 공간 불러오기", () => {
  test("Video — 두 번째 요청이 돌아오지 않아도 첫 응답으로 화면이 열린다", async () => {
    // 첫 실행은 성공, 두 번째 실행은 영원히 대기. 고치기 전에는 첫
    // 응답이 버려져 "불러오는 중"에서 멈췄습니다.
    getVideoProject
      .mockResolvedValueOnce(VIDEO_PROJECT)
      .mockReturnValueOnce(NEVER);

    render(
      <StrictMode>
        <VideoWorkspace projectId="3" />
      </StrictMode>,
    );

    expect(getVideoProject).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(screen.getByText("프로젝트1")).toBeDefined();
    });

    expect(screen.queryByText(/영상 프로젝트를 불러오는 중/)).toBeNull();
  });

  test("Builder — 같은 상황에서 같게 동작한다", async () => {
    getBuilderProject
      .mockResolvedValueOnce(BUILDER_PROJECT)
      .mockReturnValueOnce(NEVER);

    render(
      <StrictMode>
        <BuilderWorkspace projectId="4" />
      </StrictMode>,
    );

    // 이름은 전환 메뉴 버튼과 분할 보기 버튼 두 곳에 나옵니다.
    await waitFor(() => {
      expect(screen.getAllByText("가계부").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/프로젝트를 불러오는 중/)).toBeNull();
  });

  test("정말 못 불러오면 오류 카드가 뜬다 — 멈춘 채로 두지 않는다", async () => {
    // 두 요청이 모두 실패하는 경우. 이때는 "불러오는 중"이 아니라
    // 무엇이 잘못됐는지 읽을 수 있는 화면이 나와야 합니다.
    getVideoProject.mockRejectedValue(new Error("서버에 연결할 수 없습니다"));

    render(
      <StrictMode>
        <VideoWorkspace projectId="3" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("영상 프로젝트를 열 수 없습니다")).toBeDefined();
    });
  });

  test("먼저 성공한 뒤 두 번째가 실패해도 오류로 덮지 않는다", async () => {
    // 첫 응답으로 화면이 열린 다음 두 번째 요청이 실패하는 경우입니다.
    // 잘 보이던 화면을 오류 카드로 바꿔 버리면 고치려던 것보다 나쁩니다.
    getVideoProject
      .mockResolvedValueOnce(VIDEO_PROJECT)
      .mockRejectedValueOnce(new Error("응답 시간이 초과되었습니다"));

    render(
      <StrictMode>
        <VideoWorkspace projectId="3" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("프로젝트1")).toBeDefined();
    });

    expect(screen.queryByText("영상 프로젝트를 열 수 없습니다")).toBeNull();
  });
});
