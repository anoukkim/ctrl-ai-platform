/**
 * 썸네일 캡처 (ui-improvements — owner-polish 4·5).
 *
 * 회원의 앱은 CTRL+AI 서버에서 실행되지 않습니다(CLAUDE.md §8·§10). 그래서
 * 썸네일도 **만든 사람의 브라우저에서** 찍습니다: 이 화면이 앱 주소의
 * 셸(apps.ctrlai.my)에 postMessage로 부탁하면, 셸이 안쪽 앱 프레임의 SDK에
 * 넘기고, SDK가 페이지를 그림(PNG)으로 만들어 같은 길로 돌려줍니다. 셸은
 * 이 사이트 출처에서 온 부탁에만 답하고(서버가 셸 페이지에 적어 둔 origin),
 * 여기서는 그 프레임의 창에서 그 출처로 온 답만 받습니다.
 *
 * 받은 그림은 `uploadThumbnail`로 올리고, 서버가 종류·크기를 확인해 다시
 * 인코딩합니다.
 */

export const CAPTURE_TIMEOUT_MS = 15_000;

interface CaptureReply {
  ctrlai: "capture";
  id: string;
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

function isReply(data: unknown): data is CaptureReply {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { ctrlai?: unknown }).ctrlai === "capture" &&
    typeof (data as { id?: unknown }).id === "string"
  );
}

/** "data:image/png;base64,…" → Blob. 다른 모양이면 throw. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("썸네일 그림의 형식이 이상해요.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

/**
 * 앱 프레임(셸)에 사진을 부탁하고 PNG Blob을 돌려받습니다.
 *
 * `appsOrigin`은 그 프레임이 떠 있는 출처(앱 주소의 origin) — 그쪽으로만
 * 보내고, 그쪽에서 온 답만 받습니다. 셸이 없거나(앱 서버가 꺼짐) 앱이
 * 그림을 만들지 못하면 `timeoutMs` 뒤 거절합니다.
 */
export interface CaptureOptions {
  timeoutMs?: number;
  /** 프레임 크기 대신 이 크기로 — 게시 창의 폰 너비 후보 (owner-polish-3 (a2)). */
  width?: number;
  height?: number;
  /** 페이지를 이만큼 내려간 자리 — 게시 창의 스크롤 후보. */
  offset?: number;
}

export function captureFrame(
  frame: HTMLIFrameElement,
  appsOrigin: string,
  { timeoutMs = CAPTURE_TIMEOUT_MS, width: wantWidth, height: wantHeight, offset = 0 }: CaptureOptions = {},
): Promise<Blob> {
  const target = frame.contentWindow;
  if (!target) return Promise.reject(new Error("앱 프레임이 아직 없어요."));
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const width = Math.max(1, Math.round(wantWidth || frame.clientWidth || 1280));
  const height = Math.max(1, Math.round(wantHeight || frame.clientHeight || 800));

  return new Promise<Blob>((resolve, reject) => {
    const finish = (done: () => void) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      done();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target || event.origin !== appsOrigin) return;
      if (!isReply(event.data) || event.data.id !== id) return;
      const reply = event.data;
      finish(() => {
        if (!reply.ok || typeof reply.dataUrl !== "string") {
          reject(new Error(reply.error || "썸네일을 만들지 못했어요."));
          return;
        }
        try {
          resolve(dataUrlToBlob(reply.dataUrl));
        } catch (error) {
          reject(error);
        }
      });
    };
    const timer = setTimeout(() => finish(() => reject(new Error("썸네일을 만드는 데 너무 오래 걸려요."))), timeoutMs);
    window.addEventListener("message", onMessage);
    target.postMessage({ ctrlai: "capture", id, width, height, offset: Math.max(0, Math.round(offset)) }, appsOrigin);
  });
}

/** 앱 주소에서 그 출처만. 주소가 이상하면 null. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
