/**
 * 작업 공간에서 내 목록으로 돌아가는 길.
 *
 * Video 작업 공간의 오른쪽 위 "내 영상" 버튼이 Profile로 갔습니다. Profile은
 * 요약만 보여 주는 곳이라, 내 영상을 찾는 사람이 영상 목록이 아닌 곳에서
 * 끝났습니다.
 *
 * 돌아가는 길은 두 작업 공간 모두 왼쪽 위 링크 하나입니다 — 같은 자리,
 * 같은 아이콘, 같은 짜임. 오른쪽에 같은 곳으로 가는 버튼을 하나 더 두면
 * 같은 일을 하는 길이 둘이 되고, 둘 중 무엇이 다른지 설명할 수 없습니다.
 *
 * 이 테스트가 고정하는 것은 **어디로 가는가**입니다: /video와 /builder,
 * 그리고 작업 공간 어디에도 Profile로 가는 길이 없다는 것.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { BuilderProject, VideoProjectDetail } from "@/lib/projects";

const VIDEO_PROJECT: VideoProjectDetail = {
  id: 3,
  name: "서울의 밤",
  prompt: "비 오는 밤 서울",
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
  name: "습관 관리 앱",
  description: "",
  status: "draft",
  github_repo: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getVideoProject: vi.fn().mockResolvedValue(VIDEO_PROJECT),
    getBuilderProject: vi.fn().mockResolvedValue(BUILDER_PROJECT),
    listVideoModels: vi.fn().mockResolvedValue([]),
    listVideoProjects: vi.fn().mockResolvedValue([]),
    listBuilderProjects: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ quarter: null, loading: false }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/workspace.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("@/app/video/[projectId]/workspace.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("@/app/builder/[projectId]/workspace.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

const { default: VideoWorkspace } = await import("@/app/video/[projectId]/VideoWorkspace");
const { default: BuilderWorkspace } = await import(
  "@/app/builder/[projectId]/BuilderWorkspace"
);

/** 위쪽 막대 안의 링크 주소만 모읍니다. */
function topbarHrefs(): string[] {
  const bar = document.querySelector(".topbar");
  if (!bar) throw new Error("위쪽 막대를 찾지 못했습니다");
  return [...bar.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Video 작업 공간", () => {
  test("돌아가는 링크는 /video로 간다", async () => {
    render(<VideoWorkspace projectId="3" />);
    await waitFor(() => expect(document.querySelector(".topbar")).not.toBeNull());

    const back = screen.getByRole("link", { name: /Video Generator/ });
    expect(back.getAttribute("href")).toBe("/video");
  });

  test("위쪽 막대에 Profile로 가는 길이 없다", async () => {
    render(<VideoWorkspace projectId="3" />);
    await waitFor(() => expect(document.querySelector(".topbar")).not.toBeNull());

    expect(topbarHrefs()).not.toContain("/profile");
    // "내 영상"이라는 이름의 버튼은 이제 없습니다 — 왼쪽 링크가 그 일을 합니다.
    expect(screen.queryByRole("link", { name: "내 영상" })).toBeNull();
  });

  test("같은 곳으로 가는 길이 둘이 아니다", async () => {
    render(<VideoWorkspace projectId="3" />);
    await waitFor(() => expect(document.querySelector(".topbar")).not.toBeNull());

    expect(topbarHrefs().filter((href) => href === "/video")).toHaveLength(1);
  });
});

describe("Builder 작업 공간", () => {
  test("돌아가는 링크는 /builder로 간다", async () => {
    render(<BuilderWorkspace projectId="4" />);
    await waitFor(() => expect(document.querySelector(".topbar")).not.toBeNull());

    const back = screen.getByRole("link", { name: /Project Builder/ });
    expect(back.getAttribute("href")).toBe("/builder");
  });

  test("위쪽 막대에 Profile로 가는 길이 없다", async () => {
    render(<BuilderWorkspace projectId="4" />);
    await waitFor(() => expect(document.querySelector(".topbar")).not.toBeNull());

    expect(topbarHrefs()).not.toContain("/profile");
  });

  test("같은 곳으로 가는 길이 둘이 아니다", async () => {
    render(<BuilderWorkspace projectId="4" />);
    await waitFor(() => expect(document.querySelector(".topbar")).not.toBeNull());

    expect(topbarHrefs().filter((href) => href === "/builder")).toHaveLength(1);
  });
});

describe("두 작업 공간의 위쪽 막대", () => {
  test("돌아가는 링크가 같은 자리에서 같은 모양으로 나온다", async () => {
    const { unmount } = render(<VideoWorkspace projectId="3" />);
    await waitFor(() => expect(document.querySelector(".topbar")).not.toBeNull());
    const videoBack = document.querySelector(".topbar")!.querySelector("a")!;
    const videoShape = {
      first: videoBack === document.querySelector(".topbar")!.firstElementChild,
      className: videoBack.className,
      hasIcon: videoBack.querySelector("svg") !== null,
    };
    unmount();

    render(<BuilderWorkspace projectId="4" />);
    await waitFor(() => expect(document.querySelector(".topbar")).not.toBeNull());
    const builderBack = document.querySelector(".topbar")!.querySelector("a")!;

    // 같은 자리(막대의 첫 요소), 같은 클래스, 그리고 둘 다 아이콘이 붙습니다.
    expect(videoShape.first).toBe(true);
    expect(builderBack === document.querySelector(".topbar")!.firstElementChild).toBe(true);
    expect(builderBack.className).toBe(videoShape.className);
    expect(videoShape.hasIcon).toBe(true);
    expect(builderBack.querySelector("svg")).not.toBeNull();
  });
});
