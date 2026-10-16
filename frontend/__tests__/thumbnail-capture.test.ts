/**
 * ui-improvements — 썸네일 캡처의 창 사이 약속 (lib/thumbnail-capture).
 *
 * 부탁은 그 프레임의 창에, 앱 주소의 출처로만 보내고; 답은 같은 창에서
 * 같은 출처로 온 것만, 같은 id일 때만 받는다. 다른 출처의 답은 무시하고,
 * 답이 없으면 시간이 지나 거절한다. PNG data URL은 Blob이 된다.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { captureFrame, dataUrlToBlob, originOf } from "@/lib/thumbnail-capture";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function frameWithWindow() {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const contentWindow = frame.contentWindow!;
  const posted = vi.spyOn(contentWindow, "postMessage");
  Object.defineProperty(frame, "clientWidth", { value: 1280 });
  Object.defineProperty(frame, "clientHeight", { value: 800 });
  return { frame, contentWindow, posted };
}

function reply(source: Window, origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("captureFrame", () => {
  test("앱 주소의 출처로 부탁하고, 같은 창·출처·id의 PNG 답만 Blob으로 돌려준다", async () => {
    const { frame, contentWindow, posted } = frameWithWindow();
    const promise = captureFrame(frame, "http://apps.test");
    expect(posted).toHaveBeenCalledTimes(1);
    const [message, target] = posted.mock.calls[0];
    expect(target).toBe("http://apps.test");
    expect(message).toMatchObject({ ctrlai: "capture", width: 1280, height: 800 });
    const id = (message as { id: string }).id;

    // Wrong origin, wrong id, wrong source: ignored.
    reply(contentWindow, "http://evil.test", { ctrlai: "capture", id, ok: true, dataUrl: PNG });
    reply(contentWindow, "http://apps.test", { ctrlai: "capture", id: "other", ok: true, dataUrl: PNG });
    reply(window, "http://apps.test", { ctrlai: "capture", id, ok: true, dataUrl: PNG });
    reply(contentWindow, "http://apps.test", { ctrlai: "capture", id, ok: true, dataUrl: PNG });

    const blob = await promise;
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(50);
  });

  test("앱이 실패를 알리면 그 이유로 거절한다", async () => {
    const { frame, contentWindow, posted } = frameWithWindow();
    const promise = captureFrame(frame, "http://apps.test");
    const id = (posted.mock.calls[0][0] as { id: string }).id;
    reply(contentWindow, "http://apps.test", { ctrlai: "capture", id, ok: false, error: "페이지가 너무 커요" });
    await expect(promise).rejects.toThrow("페이지가 너무 커요");
  });

  test("답이 없으면 시간이 지나 거절한다", async () => {
    const { frame } = frameWithWindow();
    const promise = captureFrame(frame, "http://apps.test", { timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(promise).rejects.toThrow(/너무 오래/);
  });
});

describe("helpers", () => {
  test("PNG data URL만 Blob이 된다", () => {
    expect(dataUrlToBlob(PNG).type).toBe("image/png");
    expect(() => dataUrlToBlob("data:text/html;base64,PHA+")).toThrow();
    expect(() => dataUrlToBlob("javascript:alert(1)")).toThrow();
  });

  test("앱 주소에서 출처만", () => {
    expect(originOf("http://apps.test/abc/?v=1")).toBe("http://apps.test");
    expect(originOf("nope")).toBeNull();
    expect(originOf(null)).toBeNull();
  });
});
