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

export interface RequestOptions extends RequestInit {
  /** 이 요청만의 대기 시간(ms). Claude가 파일을 쓰는 요청처럼 오래 걸리는 것만. */
  timeoutMs?: number;
}

/**
 * 본문 없는 POST에도 `{}`를 JSON으로 보냅니다 (builder-static-runtime).
 *
 * 회원 앱이 도는 apps.ctrlai.my는 ctrlai.my와 같은 사이트라서, 그 페이지가
 * 형식 없는 POST를 보내면 브라우저가 사전 확인(preflight) 없이 보냅니다.
 * 그래서 백엔드는 JSON이 아닌 POST를 모두 거절합니다(415, CLAUDE.md §2).
 */
export async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const { timeoutMs, ...options } = init ?? {};
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs ?? REQUEST_TIMEOUT_MS);

  const method = (options.method ?? "GET").toUpperCase();
  const body = options.body ?? (method === "POST" ? "{}" : undefined);

  try {
    const response = await fetch(`${API_BASE_URL}/api${path}`, {
      ...options,
      body,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      // 백엔드는 한국어 detail을 돌려줍니다. 있으면 그대로 보여 줍니다.
      let detail = `요청이 실패했습니다 (HTTP ${response.status})`;
      try {
        const body = await response.json();
        if (body && typeof body.detail === "string") detail = body.detail;
        // 422(스키마가 거절)는 목록으로 옵니다. 백엔드가 쓴 한국어 문장을
        // 꺼내고, Pydantic이 붙이는 "Value error, "는 뗍니다.
        else if (body && Array.isArray(body.detail) && body.detail.length > 0) {
          const message = String(body.detail[0]?.msg ?? "").replace(/^Value error, /, "");
          if (/[가-힣]/.test(message)) detail = message;
        }
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

/**
 * 파일 하나를 바이트 그대로 올립니다 — Chat 첨부(chat-plus-files)와 의견의
 * 스크린샷(feedback-screenshots)이 같이 씁니다. 본문은 파일, 이름은 `?name=`,
 * 형식은 `application/octet-stream`: 다른 출처의 페이지가 미리 확인(preflight)
 * 없이 보낼 수 있는 형식은 백엔드가 받지 않습니다(CLAUDE.md §2). 거절은
 * 백엔드의 한국어 `detail`을 그대로 던집니다.
 */
export async function uploadBytes<T>(
  path: string,
  body: Blob,
  query: Record<string, string>,
  fallback: string,
): Promise<T> {
  let response: Response;
  const search = new URLSearchParams(query).toString();
  try {
    response = await fetch(`${API_BASE_URL}/api${path}${search ? `?${search}` : ""}`, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/octet-stream" },
      body,
    });
  } catch {
    throw new ApiError("서버에 연결할 수 없습니다", 0);
  }
  if (!response.ok) {
    let detail = `${fallback} (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      /* 기본 문구 */
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}
