/**
 * Builder의 단계별 만들기(quality-tuning Q2).
 *
 * 1. 계획 — Claude가 만들 파일과 각 파일의 쓰임을 정합니다(작은 호출, 차감).
 * 2. 파일 하나씩 — 파일마다 따로 쓰고, 다 쓴 파일은 바로 저장됩니다.
 * 3. 점검 — 끊긴 연결·없는 id 같은 문제를 한 번 고칩니다.
 *
 * 중간에 멈춰도 다 쓴 파일은 남고, 같은 작업을 다시 실행하면(이어서
 * 만들기) 남은 파일부터 씁니다. 호출마다 쓴 만큼 차감되고, 실패한 호출은
 * 청구되지 않습니다.
 */

import { API_BASE_URL, ApiError } from "./api";
import { request } from "./http";

/** answered — builder-answer-only: 질문에 답만 했고 실행할 것이 없어요. */
export type GenerationStatus = "planned" | "running" | "partial" | "failed" | "done" | "cancelled" | "answered";

export interface PlanStep {
  path: string;
  /** 이 파일이 무엇을 맡는지 한 문장. */
  purpose: string;
}

export interface Generation {
  id: number;
  kind: "create" | "edit";
  request: string;
  style: string;
  summary: string;
  /**
   * builder-answer-only: 회원이 바꿔 달라는 대신 물어본 때의 Claude 답.
   * 바꾸자는 계획이 함께 오면(status "planned") 적용하기로 실행해요.
   */
  answer?: string;
  plan: PlanStep[];
  files_done: string[];
  status: GenerationStatus;
  check_summary: string;
  check_fixed: string[];
  charged_krw: number;
  /** 마지막 실패의 한국어 설명. 없으면 빈 문자열. */
  error: string;
  version_number: number | null;
  /** builder-snapshots: 이 실행이 만든 작업 단계(버전이 아니에요). */
  step_seq?: number | null;
  created_at: string;
  /** 시작 / 이어서 만들기 옆의 "약 N원"과 호출마다 "최대 M원". */
  estimated_krw: number | null;
  max_call_krw: number | null;
}

/** 처음 만들 때의 짧은 질문(건너뛸 수 있음). */
export interface PlanInput {
  request: string;
  style?: string;
  who?: string;
  features?: string;
  mood?: string;
}

/** 계획 호출은 짧지만 Claude가 바쁘면 조금 걸립니다 — 서버의 300초보다 넉넉하게. */
const PLAN_TIMEOUT_MS = 330_000;

export function planGeneration(projectId: number | string, input: PlanInput): Promise<Generation> {
  return request<Generation>(`/builder/projects/${projectId}/plan`, {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: PLAN_TIMEOUT_MS,
  });
}

/** 끝나지 않은 작업(계획만 있거나, 중간에 멈춘 것). 없으면 null. */
export function getOpenGeneration(projectId: number | string): Promise<Generation | null> {
  return request<Generation | null>(`/builder/projects/${projectId}/generation`);
}

export function cancelGeneration(projectId: number | string, generationId: number): Promise<Generation> {
  return request<Generation>(`/builder/projects/${projectId}/generations/${generationId}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export interface RunHandlers {
  onFileStart?: (path: string) => void;
  onFileDone?: (path: string, chargedKrw: number) => void;
  /**
   * builder-file-continue: 긴 파일을 한 번에 다 못 써서 쓴 데까지 저장했고,
   * 서버가 바로 이어서 써요. `chars`는 지금까지 쓴 글자 수.
   */
  onFileProgress?: (path: string, chars: number, chargedKrw: number) => void;
  onCheckStart?: () => void;
  onCheckDone?: (fixed: string[], summary: string, chargedKrw: number) => void;
}

export type RunOutcome =
  | { kind: "done"; chargedKrw: number; filesDone: string[]; checkFixed: string[] }
  | { kind: "error"; detail: string; partial: boolean; filesDone: string[] }
  /** 연결이 끊겼습니다 — 서버는 계속 만들 수 있으니 작업을 다시 읽어 봅니다. */
  | { kind: "disconnected"; detail: string };

/**
 * 시작 / 이어서 만들기. 단계마다 이벤트가 옵니다(file_start, file_done,
 * check_start, check_done, 그리고 done 또는 error). 화면을 닫아도 서버는
 * 끝까지 만들고 저장합니다.
 */
export async function runGeneration(
  projectId: number | string,
  generationId: number,
  handlers: RunHandlers,
  signal?: AbortSignal,
): Promise<RunOutcome> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/builder/projects/${projectId}/generations/${generationId}/run`,
      {
        method: "POST",
        signal,
        cache: "no-store",
        headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError("서버에 연결할 수 없습니다", 0);
    throw error;
  }
  if (!response.ok || !response.body) {
    let detail = `요청이 실패했습니다 (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      /* 본문이 JSON이 아니면 기본 문구 */
    }
    throw new ApiError(detail, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: RunOutcome | null = null;

  const handle = (block: string) => {
    let name = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) name = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!name || !data) return;
    const payload = JSON.parse(data);
    if (name === "file_start") handlers.onFileStart?.(payload.path);
    else if (name === "file_done") handlers.onFileDone?.(payload.path, payload.charged_krw ?? 0);
    else if (name === "file_progress")
      handlers.onFileProgress?.(payload.path, payload.chars ?? 0, payload.charged_krw ?? 0);
    else if (name === "check_start") handlers.onCheckStart?.();
    else if (name === "check_done")
      handlers.onCheckDone?.(payload.fixed ?? [], payload.summary ?? "", payload.charged_krw ?? 0);
    else if (name === "done")
      outcome = {
        kind: "done",
        chargedKrw: payload.charged_krw ?? 0,
        filesDone: payload.files_done ?? [],
        checkFixed: payload.check_fixed ?? [],
      };
    else if (name === "error")
      outcome = {
        kind: "error",
        detail: payload.detail,
        partial: Boolean(payload.partial),
        filesDone: payload.files_done ?? [],
      };
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        handle(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch {
    return { kind: "disconnected", detail: "만드는 중에 연결이 끊어졌어요. 다 쓴 파일은 저장돼 있어요." };
  }
  if (buffer.trim()) handle(buffer);
  return outcome ?? { kind: "disconnected", detail: "끝까지 소식이 오지 않았어요. 다 쓴 파일은 저장돼 있어요." };
}
