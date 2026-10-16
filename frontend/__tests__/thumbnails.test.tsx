/**
 * ui-improvements (owner-polish 4·5) — 썸네일이 화면에 닿는 곳.
 *
 * Builder 카드: 작업 중 썸네일 → 게시본 썸네일 → 표지. CtrlAIApps 카드와
 * 상세 머리 줄: 게시본 썸네일 → 표지. 미리보기: 프레임이 뜨면 잠시 뒤
 * 캡처해 올리고, ⋯의 "썸네일 다시 찍기"가 있다.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AppListing } from "@/lib/apps";
import type { BuilderProject } from "@/lib/projects";

const capture = vi.hoisted(() => ({ captureFrame: vi.fn() }));
vi.mock("@/lib/thumbnail-capture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/thumbnail-capture")>()),
  captureFrame: (...args: unknown[]) => capture.captureFrame(...args),
}));

const { default: Thumbnail, AppThumbnail } = await import("@/app/ctrlaistore/AppThumbnail");
const { default: AppCard } = await import("@/app/ctrlaistore/AppCard");
const { default: PreviewPane, CAPTURE_DELAY_MS } = await import("@/app/builder/[projectId]/PreviewPane");
const { builderThumbnailUrl } = await import("@/lib/projects");

const APP: AppListing = {
  id: 7,
  slug: "k3m9qx7pwa",
  name: "오늘 할 일",
  description: "할 일을 적고 지우는 앱이에요.",
  author_name: "김유리",
  author_username: "yurikim",
  version_number: 3,
  published_at: "2026-10-16T00:00:00Z",
  publish_note: "",
  app_url: "http://apps.test/k3m9qx7pwa/",
  shared_lists: false,
  favorite: false,
  thumbnail_at: null,
};

const PROJECT: Pick<BuilderProject, "id" | "draft_thumbnail_at" | "published_thumbnail_at"> = {
  id: 12,
  draft_thumbnail_at: null,
  published_thumbnail_at: null,
};

describe("썸네일 주소", () => {
  test("Builder: 작업 중 것이 먼저, 없으면 게시본, 둘 다 없으면 없음", () => {
    expect(builderThumbnailUrl(PROJECT)).toBeNull();
    expect(builderThumbnailUrl({ ...PROJECT, published_thumbnail_at: "2026-10-16T01:00:00Z" })).toBe(
      "/api/builder/projects/12/thumbnail?space=published&v=2026-10-16T01%3A00%3A00Z",
    );
    expect(
      builderThumbnailUrl({ ...PROJECT, draft_thumbnail_at: "2026-10-16T02:00:00Z", published_thumbnail_at: "2026-10-16T01:00:00Z" }),
    ).toBe("/api/builder/projects/12/thumbnail?space=draft&v=2026-10-16T02%3A00%3A00Z");
    // owner-polish-3 (a2): a picture the maker chose wins over the automatic draft capture.
    expect(
      builderThumbnailUrl({
        ...PROJECT,
        draft_thumbnail_at: "2026-10-16T02:00:00Z",
        published_thumbnail_at: "2026-10-16T01:00:00Z",
        thumbnail_chosen_at: "2026-10-16T01:00:00Z",
      }),
    ).toBe("/api/builder/projects/12/thumbnail?space=published&v=2026-10-16T01%3A00%3A00Z");
  });
});

describe("그림 자리", () => {
  test("썸네일이 없으면 표지에 이름, 있으면 <img>, 못 불러오면 다시 표지", () => {
    const { rerender, container } = render(<Thumbnail name="오늘 할 일" seed="k3m9qx7pwa" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("오늘 할 일")).toBeTruthy();

    rerender(<Thumbnail name="오늘 할 일" seed="k3m9qx7pwa" imageUrl="/api/apps/k3m9qx7pwa/thumbnail?v=1" />);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/api/apps/k3m9qx7pwa/thumbnail?v=1");
    expect(image.getAttribute("alt")).toBe("");

    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("오늘 할 일")).toBeTruthy();
  });

  test("CtrlAIApps 카드는 게시본 썸네일을 쓴다", () => {
    const { container } = render(<AppCard app={{ ...APP, thumbnail_at: "2026-10-16T03:00:00Z" }} />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(
      "/api/apps/k3m9qx7pwa/thumbnail?v=2026-10-16T03%3A00%3A00Z",
    );
    const { container: plain } = render(<AppThumbnail app={APP} size="small" />);
    expect(plain.querySelector("img")).toBeNull();
    expect(within(plain as HTMLElement).getByText("오")).toBeTruthy();
  });
});

describe("미리보기의 캡처", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capture.captureFrame.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  test("프레임이 뜨고 잠시 뒤 한 번 찍어 올리고, ⋯에 '썸네일 다시 찍기'가 있다", async () => {
    const image = new Blob(["png"], { type: "image/png" });
    capture.captureFrame.mockResolvedValue(image);
    const onCapture = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PreviewPane
        files={{ "index.html": "<p>hi</p>" }}
        entry="index.html"
        appUrl="http://apps.test/d7r4ftw2pq/"
        runtimeAvailable
        onRefreshRuntime={() => undefined}
        stamp="2026-10-16T00:00:00Z"
        onCapture={onCapture}
      />,
    );
    const frame = container.querySelector("iframe")!;
    fireEvent.load(frame);
    expect(capture.captureFrame).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS + 10);
    });
    expect(capture.captureFrame).toHaveBeenCalledWith(frame, "http://apps.test");
    expect(onCapture).toHaveBeenCalledWith(image, false);

    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "미리보기 도구 더 보기" }));
    await user.click(screen.getByRole("menuitem", { name: /썸네일 다시 찍기/ }));
    await waitFor(() => expect(onCapture).toHaveBeenLastCalledWith(image, true));
  });

  test("손으로 찍을 때 실패하면 이유를 보여 주고, 자동은 조용하다", async () => {
    capture.captureFrame.mockRejectedValue(new Error("썸네일을 만드는 데 너무 오래 걸려요."));
    const onCapture = vi.fn();
    const { container } = render(
      <PreviewPane
        files={{ "index.html": "<p>hi</p>" }}
        entry="index.html"
        appUrl="http://apps.test/d7r4ftw2pq/"
        stamp="x"
        onCapture={onCapture}
      />,
    );
    fireEvent.load(container.querySelector("iframe")!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS + 10);
    });
    expect(screen.queryByRole("alert")).toBeNull();

    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "미리보기 도구 더 보기" }));
    await user.click(screen.getByRole("menuitem", { name: /썸네일 다시 찍기/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("너무 오래"));
    expect(onCapture).not.toHaveBeenCalled();
  });

  test("onCapture가 없으면 아무것도 찍지 않는다", async () => {
    const { container } = render(
      <PreviewPane files={{ "index.html": "<p>hi</p>" }} entry="index.html" appUrl="http://apps.test/d7r4ftw2pq/" stamp="x" />,
    );
    fireEvent.load(container.querySelector("iframe")!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS + 10);
    });
    expect(capture.captureFrame).not.toHaveBeenCalled();
  });
});
