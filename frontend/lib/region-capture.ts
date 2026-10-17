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
 * 화면 좌표(CSS 픽셀)의 상자 → 받은 영상 프레임 안의 상자. 탭 전체가 영상에
 * **한 배율**로 들어가고(화면 배율 포함), 공유 안내 줄 때문에 창 비율이
 * 영상과 달라지면 남는 자리는 검은 띠로 가운데 정렬돼요 — 그 띠만큼 옮겨서
 * 잘라요. 영상 밖으로는 나가지 않아요.
 */
export function cropBox(
  rect: Box,
  viewport: { width: number; height: number },
  video: { width: number; height: number },
): Box {
  const scale = Math.min(video.width / viewport.width, video.height / viewport.height);
  const offsetX = (video.width - viewport.width * scale) / 2;
  const offsetY = (video.height - viewport.height * scale) / 2;
  const left = Math.max(0, Math.round(offsetX + rect.left * scale));
  const top = Math.max(0, Math.round(offsetY + rect.top * scale));
  const width = Math.max(1, Math.min(video.width - left, Math.round(rect.width * scale)));
  const height = Math.max(1, Math.min(video.height - top, Math.round(rect.height * scale)));
  return { left, top, width, height };
}

/**
 * 이 탭의 표식 — 공유된 탭이 정말 이 탭인지 확인해요(다른 탭의 화면이
 * 썸네일로 올라가면 안 돼요). Chrome의 Capture Handle; 없는 브라우저는
 * 확인할 수 없으니 찍지 않고 사진 올리기를 권해요.
 */
let ownHandle: string | null = null;
function markThisTab(): string | null {
  const devices = navigator.mediaDevices as MediaDevices & {
    setCaptureHandleConfig?: (config: { handle: string; exposeOrigin?: boolean; permittedOrigins: string[] }) => void;
  };
  if (typeof devices.setCaptureHandleConfig !== "function") return null;
  ownHandle ??= `ctrlai-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  try {
    devices.setCaptureHandleConfig({ handle: ownHandle, exposeOrigin: false, permittedOrigins: [window.location.origin] });
  } catch {
    return null;
  }
  return ownHandle;
}

export function regionCaptureSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/** The next video frame — or, for a still page that sends none, 300 ms. */
function nextFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 300);
    const withCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (typeof withCallback.requestVideoFrameCallback === "function") {
      withCallback.requestVideoFrameCallback(() => {
        clearTimeout(timer);
        resolve();
      });
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
  const handle = markThisTab();
  if (handle === null) {
    throw new RegionCaptureError("이 브라우저에서는 이 탭만 골라 찍을 수 없어요.", "unsupported");
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
    const shared = (track as MediaStreamTrack & { getCaptureHandle?: () => { handle?: string } | null })
      ?.getCaptureHandle?.();
    if (!shared || shared.handle !== handle) {
      throw new RegionCaptureError("이 탭을 골라 주세요 — 다른 탭이나 창, 화면은 찍지 않아요.", "wrong-surface");
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
