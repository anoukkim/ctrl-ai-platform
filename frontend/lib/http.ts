/**
 * 백엔드 호출의 공통 부분.
 *
 * 주소, 제한 시간, 오류 문구 처리를 한곳에 모읍니다. 화면은 물론이고
 * 각 기능별 클라이언트(projects.ts, quarters.ts)도 이 함수만 씁니다.
 */

import { API_BASE_URL, ApiError } from "./api";

/** 요청의 최대 대기 시간(ms). 백엔드가 꺼져 있을 때 화면이 멈춘 것처럼
 *  보이지 않도록 끊습니다. */
export const REQUEST_TIMEOUT_MS = 8000;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      // 백엔드는 한국어 detail을 돌려줍니다. 있으면 그대로 보여 줍니다.
      let detail = `요청이 실패했습니다 (HTTP ${response.status})`;
      try {
        const body = await response.json();
        if (body && typeof body.detail === "string") detail = body.detail;
      } catch {
        /* 본문이 없거나 JSON이 아니면 기본 문구를 씁니다 */
      }
      throw new ApiError(detail, response.status);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (timedOut) throw new ApiError("응답 시간이 초과되었습니다", 0);
    if (error instanceof TypeError) throw new ApiError("서버에 연결할 수 없습니다", 0);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 오류를 한국어 한 줄로. 화면마다 다시 쓰지 않도록 여기에 둡니다. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "서버에 연결할 수 없습니다";
  return "알 수 없는 오류가 발생했습니다";
}
