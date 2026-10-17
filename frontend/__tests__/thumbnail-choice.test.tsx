/**
 * thumbnail-choice (owner, 2026-10-17) — 썸네일 지정.
 *
 * 파일 목록 아래의 썸네일 패널(자동 / 직접 지정, 지정하기, 사진 올리기,
 * 자동으로 되돌리기), 미리보기 위 16:10 틀(앱은 그대로 쓸 수 있고 「이 화면으로」
 * 는 이 탭을 한 장만 받아 공유를 바로 멈춰요), 그리고 자른 자리 계산.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import ThumbnailFrame, { MIN_WIDTH, RATIO, clampBox, initialBox } from "@/app/builder/[projectId]/ThumbnailFrame";
import ThumbnailPanel from "@/app/builder/[projectId]/ThumbnailPanel";
import { builderThumbnailUrl } from "@/lib/projects";
import { RegionCaptureError, captureRegion, cropBox } from "@/lib/region-capture";

const PROJECT = { id: 12, draft_thumbnail_at: "2026-10-17T01:00:00Z", published_thumbnail_at: null, thumbnail_chosen_at: null };

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error — test cleanup of the stubbed API
  delete navigator.mediaDevices;
});

describe("썸네일 주소", () => {
  test("직접 지정한 그림이 있으면 그것이 언제나 먼저 — 고른 때를 붙여 바로 바뀌어요", () => {
    const chosen = { ...PROJECT, published_thumbnail_at: "2026-10-17T02:00:00Z", thumbnail_chosen_at: "2026-10-17T03:00:00Z" };
    expect(builderThumbnailUrl(chosen)).toBe("/api/builder/projects/12/thumbnail?space=draft&v=2026-10-17T03%3A00%3A00Z");
  });
});

describe("자를 자리", () => {
  test("화면 좌표를 받은 영상의 배율로 늘리고 영상 밖으로는 나가지 않아요", () => {
    // 2배 화면: 창 1000×600 → 영상 2000×1200.
    expect(cropBox({ left: 100, top: 50, width: 320, height: 200 }, { width: 1000, height: 600 }, { width: 2000, height: 1200 })).toEqual({
      left: 200,
      top: 100,
      width: 640,
      height: 400,
    });
    // 오른쪽 끝을 넘으면 잘려요.
    expect(cropBox({ left: 900, top: 0, width: 320, height: 200 }, { width: 1000, height: 600 }, { width: 1000, height: 600 }).width).toBe(100);
  });

  test("틀은 16:10을 지키고 칸 안에 머물며 너무 작아지지 않아요", () => {
    const area = { width: 800, height: 500 };
    const first = initialBox(area);
    expect(first.width).toBeCloseTo(480);
    expect(first.x).toBeCloseTo(160);
    expect(first.y).toBeCloseTo((500 - 480 / RATIO) / 2);
    expect(clampBox({ x: -50, y: 9999, width: 10 }, area)).toEqual({ x: 0, y: 500 - MIN_WIDTH / RATIO, width: MIN_WIDTH });
    // 세로가 모자라면 칸 높이에 맞춰요.
    expect(clampBox({ x: 0, y: 0, width: 5000 }, area).width).toBe(800);
    expect(clampBox({ x: 0, y: 0, width: 5000 }, { width: 800, height: 300 }).width).toBe(300 * RATIO);
  });
});

function fakeDisplayMedia(surface = "browser") {
  const stop = vi.fn();
  const track = { stop, getSettings: () => ({ displaySurface: surface }) };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  const getDisplayMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { value: { getDisplayMedia }, configurable: true });
  return { getDisplayMedia, stop };
}

describe("이 화면으로 — 한 장만, 공유는 바로 멈춰요", () => {
  test("이 탭을 권하고, 받은 뒤에는 무슨 일이 있어도 공유를 멈춰요", async () => {
    const { getDisplayMedia, stop } = fakeDisplayMedia();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("jsdom has no video"));
    await expect(captureRegion(() => ({ left: 0, top: 0, width: 10, height: 10 }))).rejects.toBeInstanceOf(RegionCaptureError);
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ preferCurrentTab: true, audio: false }));
    expect(stop).toHaveBeenCalled();
  });

  test("다른 창이나 화면을 고르면 찍지 않고 멈춰요", async () => {
    const { stop } = fakeDisplayMedia("monitor");
    await expect(captureRegion(() => ({ left: 0, top: 0, width: 10, height: 10 }))).rejects.toMatchObject({ reason: "wrong-surface" });
    expect(stop).toHaveBeenCalled();
  });

  test("지원하지 않거나 거절하면 사진 올리기를 권해요", async () => {
    await expect(captureRegion(() => ({ left: 0, top: 0, width: 1, height: 1 }))).rejects.toMatchObject({ reason: "unsupported" });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getDisplayMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
      configurable: true,
    });
    await expect(captureRegion(() => ({ left: 0, top: 0, width: 1, height: 1 }))).rejects.toMatchObject({ reason: "refused" });
  });
});

describe("썸네일 틀", () => {
  test("틀 층은 클릭을 앱으로 넘기고, 찍을 수 없으면 사진 올리기와 붙여넣기를 권해요", async () => {
    const onShot = vi.fn();
    const onFile = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(<ThumbnailFrame onShot={onShot} onFile={onFile} onCancel={onCancel} />);
    expect(screen.getByTestId("thumbnail-frame").className).toMatch(/layer/);
    // jsdom: getDisplayMedia가 없어요 → 「이 화면으로」 대신 사진 올리기만.
    expect(screen.queryByRole("button", { name: /이 화면으로/ })).toBeNull();
    const image = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    const paste = new Event("paste") as Event & { clipboardData: unknown };
    paste.clipboardData = { files: [image] };
    fireEvent(window, paste);
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(image));
    await waitFor(() => expect((screen.getByRole("button", { name: "취소" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  test("지원하는 브라우저에서는 「이 화면으로」가 있고, 거절하면 안내와 함께 사진 올리기로", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getDisplayMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
      configurable: true,
    });
    // jsdom has no layout: give the layer a size so the frame is drawn.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
    render(<ThumbnailFrame onShot={vi.fn()} onFile={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /틀 옮기기/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /이 화면으로/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("화면 찍기를 허락하지 않았어요. 스크린샷을 올리거나");
    expect(screen.queryByRole("button", { name: /이 화면으로/ })).toBeNull();
    expect((screen.getByRole("button", { name: "사진 올리기" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("썸네일 패널", () => {
  test("자동일 때: 자동 표시, 지정하기와 사진 올리기, 되돌리기는 없어요", async () => {
    const onFrame = vi.fn();
    const onFile = vi.fn().mockResolvedValue(undefined);
    render(
      <ThumbnailPanel project={PROJECT} disabled={false} canFrame framing={false} onFrame={onFrame} onFile={onFile} onReset={vi.fn()} />,
    );
    expect(screen.getByText("자동")).toBeTruthy();
    expect(screen.getByRole("img", { name: /자동 썸네일/ }).getAttribute("src")).toContain("space=draft");
    expect(screen.queryByRole("button", { name: /자동으로 되돌리기/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /지정하기/ }));
    expect(onFrame).toHaveBeenCalled();
    const image = new File(["x"], "shot.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("thumbnail-file"), image);
    expect(onFile).toHaveBeenCalledWith(image);
  });

  test("직접 지정했을 때: 표시가 바뀌고 자동으로 되돌리기가 있어요; 미리보기가 없으면 지정하기는 꺼져요", async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    render(
      <ThumbnailPanel
        project={{ ...PROJECT, thumbnail_chosen_at: "2026-10-17T03:00:00Z" }}
        disabled={false}
        canFrame={false}
        framing={false}
        onFrame={vi.fn()}
        onFile={vi.fn()}
        onReset={onReset}
      />,
    );
    expect(screen.getByText("직접 지정")).toBeTruthy();
    expect((screen.getByRole("button", { name: /지정하기/ }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /자동으로 되돌리기/ }));
    expect(onReset).toHaveBeenCalled();
  });
});
