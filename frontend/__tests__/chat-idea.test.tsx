/**
 * Chat의 액션 단추가 연 목록 화면 — 새 프로젝트 칸이 아이디어로 채워져 있는지.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const replace = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/builder",
  useSearchParams: () => search,
}));

const createBuilderProject = vi.fn();
const createVideoProject = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    listBuilderProjects: vi.fn().mockResolvedValue([]),
    listVideoProjects: vi.fn().mockResolvedValue([]),
    createBuilderProject: (...args: unknown[]) => createBuilderProject(...args),
    createVideoProject: (...args: unknown[]) => createVideoProject(...args),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ quarter: null, loading: false, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

describe("a library opened from Chat", () => {
  beforeEach(() => {
    replace.mockReset();
    createBuilderProject.mockReset().mockResolvedValue({});
    createVideoProject.mockReset().mockResolvedValue({});
  });

  test("Builder opens the new-project form with the name and keeps the idea as the description", async () => {
    search = new URLSearchParams({ idea: "가계부 앱을 만들고 싶어요", name: "가계부" });
    const { default: BuilderLibrary } = await import("@/app/builder/BuilderLibrary");
    render(<BuilderLibrary />);

    const name = screen.getByLabelText("새 프로젝트 이름") as HTMLInputElement;
    expect(name.value).toBe("가계부");
    expect(screen.getByText("가계부 앱을 만들고 싶어요")).toBeTruthy();
    // The idea is read once; the address forgets it so a reload starts clean.
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/builder", { scroll: false }));

    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() =>
      expect(createBuilderProject).toHaveBeenCalledWith({
        name: "가계부",
        description: "가계부 앱을 만들고 싶어요",
      }),
    );
  });

  test("Video uses the idea as the prompt", async () => {
    search = new URLSearchParams({ idea: "도쿄 야경 20초 쇼츠" });
    const { default: VideoLibrary } = await import("@/app/video/VideoLibrary");
    render(<VideoLibrary />);

    const name = screen.getByLabelText(/이름/) as HTMLInputElement;
    expect(name.value).toBe("도쿄 야경 20초 쇼츠");

    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() =>
      expect(createVideoProject).toHaveBeenCalledWith({
        name: "도쿄 야경 20초 쇼츠",
        prompt: "도쿄 야경 20초 쇼츠",
      }),
    );
  });

  test("without an idea the form stays closed", async () => {
    search = new URLSearchParams();
    const { default: BuilderLibrary } = await import("@/app/builder/BuilderLibrary");
    render(<BuilderLibrary />);
    expect(screen.queryByLabelText("새 프로젝트 이름")).toBeNull();
  });
});
