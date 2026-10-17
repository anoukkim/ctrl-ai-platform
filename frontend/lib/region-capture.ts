/**
 * thumbnail-choice — 지금 화면의 진짜 픽셀을 한 장 (owner, 2026-10-17).
 *
 * 앱은 다른 출처의 샌드박스 프레임 안에서 돌기 때문에 페이지가 그 안의
 * 픽셀을 읽을 수 없어요. 그래서 브라우저의 화면 공유
 * (`getDisplayMedia`, `preferCurrentTab`)로 **이 탭**을 한 프레임만 받고,
 * 곧바로 공유를 멈춘 뒤 16:10 틀의 자리만 잘라 냅니다. 받은 그림은 썸네일
 * 업로드 말고는 어디에도 가지 않아요. 지원하지 않는 브라우저(Safari 등)나
 * 회원이 공유를 거절하면 `RegionCaptureError` — 화면은 붙여넣기/올리기를
 * 권합니다.
 */

export class RegionCaptureError extends Error {
  /** "unsupported" | "refused" | "wrong-surface" | "failed" */
  constructor(
    message: string,
    readonly reason: "unsupported" | "refused" | "wrong-surface" | "failed",
  ) {
    super(message);
  }
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 화면 좌표(CSS 픽셀)의 상자 → 받은 영상 프레임 안의 상자. 탭 전체가
 * 영상이므로 가로·세로를 각각 영상 크기 ÷ 창 크기로 늘립니다(화면 배율과
 * 공유 안내 줄이 바꾼 높이를 함께 담아요). 영상 밖으로는 나가지 않아요.
 */
export function cropBox(
  rect: Box,
  viewport: { width: number; height: number },
  video: { width: number; height: number },
): Box {
  const sx = video.width / viewport.width;
  const sy = video.height / viewport.height;
  const left = Math.max(0, Math.round(rect.left * sx));
  const top = Math.max(0, Math.round(rect.top * sy));
  const width = Math.max(1, Math.min(video.width - left, Math.round(rect.width * sx)));
  const height = Math.max(1, Math.min(video.height - top, Math.round(rect.height * sy)));
  return { left, top, width, height };
}

export function regionCaptureSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

function nextFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const withCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (typeof withCallback.requestVideoFrameCallback === "function") {
      withCallback.requestVideoFrameCallback(() => resolve());
    } else {
      setTimeout(resolve, 120);
    }
  });
}

/**
 * 이 탭을 한 프레임 받아 `measure()`가 돌려주는 상자만큼 잘라 PNG로.
 * `beforeGrab`은 프레임을 받기 직전에 불려요 — 틀과 단추를 숨길 때.
 * 공유는 어떤 경우에도 끝에서 멈춥니다.
 */
export async function captureRegion(
  measure: () => Box,
  beforeGrab: () => Promise<void> | void = () => undefined,
): Promise<Blob> {
  if (!regionCaptureSupported()) {
    throw new RegionCaptureError("이 브라우저에서는 화면을 찍을 수 없어요.", "unsupported");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
      // Chrome: 지금 탭을 먼저 권해요(다른 브라우저는 모르는 옵션은 무시).
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions);
  } catch {
    throw new RegionCaptureError("화면 찍기를 허락하지 않았어요.", "refused");
  }
  const video = document.createElement("video");
  try {
    const [track] = stream.getVideoTracks();
    const surface = track?.getSettings?.().displaySurface;
    if (surface && surface !== "browser") {
      throw new RegionCaptureError("이 탭을 골라 주세요 — 다른 창이나 화면은 찍을 수 없어요.", "wrong-surface");
    }
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await beforeGrab();
    await nextFrame(video);
    await nextFrame(video);
    const rect = measure();
    const box = cropBox(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      { width: video.videoWidth, height: video.videoHeight },
    );
    const canvas = document.createElement("canvas");
    canvas.width = box.width;
    canvas.height = box.height;
    const context = canvas.getContext("2d");
    if (!context) throw new RegionCaptureError("화면을 그리지 못했어요.", "failed");
    context.drawImage(video, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new RegionCaptureError("화면을 그리지 못했어요.", "failed"))),
        "image/png",
      ),
    );
  } catch (error) {
    if (error instanceof RegionCaptureError) throw error;
    throw new RegionCaptureError("화면을 찍지 못했어요.", "failed");
  } finally {
    // 한 장이면 끝 — 공유 표시가 바로 꺼지게.
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  }
}
