/**
 * Ctrl AI 백엔드 클라이언트.
 *
 * 네트워크 호출은 화면이 아니라 이 파일에 모읍니다. 그래야 화면 안에
 * 주소가 흩어지지 않고, 응답 모양도 한곳에서만 정의됩니다.
 */

/**
 * 백엔드 주소.
 *
 * 기본값은 빈 문자열, 즉 **같은 출처**입니다. `/api/*` 요청은 Next.js가
 * 받아서 FastAPI로 넘깁니다(next.config.ts의 rewrites). 덕분에 세션
 * 쿠키를 HttpOnly로 두고도 그대로 전송되고, 자바스크립트는 쿠키를 읽을
 * 수 없습니다.
 *
 * 다른 주소를 직접 부르도록 되돌릴 수도 있지만, 그러면 쿠키가 교차 출처가
 * 되어 로그인이 동작하지 않습니다. 개발 중 백엔드만 따로 확인할 때만
 * 쓰세요.
 *
 * `NEXT_PUBLIC_` 값은 브라우저 번들에 그대로 들어가므로 비밀이 아닌 값만
 * 넣을 수 있습니다. 제공자 API 키는 절대 여기에 두지 않습니다.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/**
 * 상태 확인 요청의 최대 대기 시간(ms).
 *
 * 백엔드가 꺼져 있거나 절전에서 깨어나는 중이면 응답이 아주 늦게 옵니다.
 * 제한이 없으면 화면이 "확인 중"에서 멈춘 것처럼 보이므로, 여기서 끊고
 * "연결 안 됨"으로 분명히 알려 줍니다.
 */
export const HEALTH_TIMEOUT_MS = 8000;

/** 데이터베이스 연결 확인 결과. */
export interface DatabaseHealth {
  status: "ok" | "unavailable";
  detail: string | null;
}

/** `GET /api/health` 응답. 백엔드의 app/schemas/health.py와 짝을 이룹니다. */
export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  version: string;
  environment: string;
  database: DatabaseHealth;
}

/** 백엔드가 2xx가 아닌 응답을 주거나 제한 시간을 넘겼을 때 던집니다. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 백엔드 상태를 가져옵니다.
 *
 * 실패하는 방법은 세 가지입니다.
 *   1. 서버가 없음        → fetch가 TypeError를 던집니다.
 *   2. 서버가 오류 응답   → ApiError
 *   3. 너무 느림          → ApiError ("응답 시간 초과")
 *
 * 화면을 벗어날 때 요청을 취소할 수 있도록 `signal`을 받습니다. 제한 시간과
 * 바깥 취소를 함께 다루기 위해 안쪽에서 컨트롤러를 하나 더 만듭니다.
 * (`AbortSignal.any`는 비교적 최근 기능이라 쓰지 않았습니다.)
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, HEALTH_TIMEOUT_MS);

  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      signal: controller.signal,
      // 상태는 항상 지금 값을 봐야 하므로 캐시를 쓰지 않습니다.
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new ApiError(`백엔드가 HTTP ${response.status}로 응답했습니다`, response.status);
    }

    return (await response.json()) as HealthResponse;
  } catch (error) {
    // 제한 시간 초과와, 화면을 벗어나서 생긴 취소를 구분합니다.
    if (timedOut) {
      throw new ApiError("응답 시간이 초과되었습니다", 0);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
