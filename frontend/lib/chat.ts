/**
 * Chat 백엔드 클라이언트 — 대화 목록과, 흘러나오는 답장.
 *
 * 답장은 Server-Sent Events로 옵니다. `EventSource`는 GET만 보낼 수
 * 있어서 쓰지 않고, `fetch`로 POST한 뒤 응답 본문을 조각조각 읽습니다.
 *
 *   event: start   한 번 — 저장된 내 메시지
 *   event: delta   여러 번 — 답장의 다음 조각
 *   event: done    한 번 — 저장된 답장과 차감된 금액
 *   event: error   한 번 — 한국어 오류. 이때는 아무것도 차감되지 않습니다.
 *
 * Claude를 부르기 **전에** 거절된 요청(분당 한도, 지원금 부족 등)은
 * 스트림이 아니라 보통의 오류 응답으로 옵니다.
 */

import { API_BASE_URL, ApiError } from "./api";
import { request } from "./http";

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  last_message_at: string;
  /** 다음 답장이 쓸 모델(`ChatModelOption.id`). null이면 기본 모델. */
  chat_model_id: number | null;
  /** 서버 도구 토글(chat-plus-tools). 모델이 허용할 때만 실제로 쓰입니다. */
  use_web_search?: boolean;
  use_web_fetch?: boolean;
  use_code_execution?: boolean;
}

/** 서버 도구 한 가지. */
export type ToolKind = "web_search" | "web_fetch" | "code_execution";

/** 답장이 인용한 출처 하나 — 번호 달린 링크로 보여 줍니다. */
export interface ReplySource {
  title: string;
  url: string;
}

export type ChatRole = "user" | "assistant";
export type ChatMessageStatus = "complete" | "stopped" | "truncated" | "refused";
export type ChatAction = "builder" | "video";

export interface ChatMessage {
  id: number;
  role: ChatRole;
  content: string;
  status: ChatMessageStatus;
  action: ChatAction | null;
  action_title: string;
  /** 답장을 쓴 모델의 ID (예: "claude-haiku-4-5"). 내 메시지는 null. */
  model_id: string | null;
  /** 답장이 1회 비용 한도에 닿아 멈췄다면 그 한도(원). 아니면 null. */
  capped_krw?: number | null;
  /** 답장의 영수증 — 장부의 숫자. 대화를 다시 열어도 그대로 옵니다. */
  receipt?: ReplyReceipt | null;
  /** 웹 검색이 인용한 출처(chat-plus-tools). 도구를 안 썼으면 null. */
  sources?: ReplySource[] | null;
  created_at: string;
}

/** 답장 하나가 실제로 쓴 토큰. 캐시 칸은 캐시가 꺼져 있으면 null입니다. */
export interface ReplyUsage {
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number | null;
  cache_read_tokens: number | null;
  /** 청구된 웹 검색 횟수와 그 요금(원). 0이면 검색 줄이 없습니다. */
  web_search_count?: number;
  tool_fee_krw?: number;
}

/** 답장 아래 영수증(live-cost-display). 합계는 장부가 차감한 금액입니다. */
export interface ReplyReceipt extends ReplyUsage {
  charged_krw: number;
}

/**
 * 흐르는 답장 옆 "약 N원"의 재료(live-cost-display). `start` 이벤트로
 * 옵니다: 입력 쪽 비용(원, 미리 계산됨)과 출력 1,000토큰당 가격(원).
 */
export interface StreamEstimate {
  base_krw: number;
  won_per_1k_output: number;
}

/**
 * 지금까지 흘러온 글로 어림한 비용(원). 백엔드의 어림과 같은 규칙 —
 * 글자 하나를 토큰 하나로 — 이라 실제보다 약간 후합니다. 화면은 반드시
 * 약을 붙여 보여 줍니다; 정산은 영수증(장부)이 합니다.
 */
export function runningEstimateKrw(estimate: StreamEstimate, streamedChars: number): number {
  return Math.max(
    1,
    Math.ceil(estimate.base_krw + (streamedChars * estimate.won_per_1k_output) / 1000),
  );
}

/** 대화가 길어졌을 때의 안내(token-guard). 짧은 대화에는 null입니다. */
export interface LongHistory {
  /** 시스템 프롬프트를 뺀, 답장마다 함께 보내는 입력 토큰 어림값. */
  history_tokens: number;
  /** 그 입력이 답장 1회에 더하는 금액(원) — 새 대화로 아끼는 금액. */
  extra_krw: number;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
  long_history?: LongHistory | null;
}

/** 입력창 옆 모델 고르기의 한 줄. 회원이 고를 수 있는 것만 옵니다. */
export interface ChatModelOption {
  id: number;
  model_id: string;
  label: string;
  description: string;
  /** 관리자에게만 보이는 모델. */
  admin_only: boolean;
  is_default: boolean;
  /** 답장 1회 어림값(원). 환율이 없으면 null. */
  estimated_reply_krw: number | null;
  /** "recent" — 최근 실제 답장의 중앙값(비용 보정), "formula" — 공식 어림값. */
  estimate_basis?: "recent" | "formula";
  estimate_samples?: number;
  /** 관리자가 이 모델에 열어 둔 서버 도구(chat-plus-tools). */
  tools_web_search?: boolean;
  tools_web_fetch?: boolean;
  tools_code_execution?: boolean;
  /** 웹 검색 1회 요금(원). 환율이 없으면 null. */
  web_search_krw_per_call?: number | null;
}

export interface ChatInfo {
  is_mock: boolean;
  rate_limit_per_minute: number;
  max_message_length: number;
  models: ChatModelOption[];
  /** 새 대화가 쓰는 모델. 모델 목록이 비었을 때만 null. */
  default_model_id: number | null;
}

export function getChatInfo(): Promise<ChatInfo> {
  return request<ChatInfo>("/chat/info");
}

export function listConversations(): Promise<Conversation[]> {
  return request<Conversation[]>("/chat/conversations");
}

export function getConversation(id: number): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/chat/conversations/${id}`);
}

/** 새 대화. 모델을 고르지 않았으면 백엔드가 기본 모델을 넣습니다. */
export function createConversation(chatModelId: number | null = null): Promise<Conversation> {
  return request<Conversation>("/chat/conversations", {
    method: "POST",
    body: JSON.stringify(chatModelId === null ? {} : { chat_model_id: chatModelId }),
  });
}

/** 대화의 모델을 바꿉니다. 이후 답장부터 적용되고, 지난 답장은 그대로입니다. */
export function setConversationModel(id: number, chatModelId: number): Promise<Conversation> {
  return request<Conversation>(`/chat/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ chat_model_id: chatModelId }),
  });
}

/**
 * 지금 화면이 보여 줄 모델. 대화가 고른 것, 없으면 기본.
 *
 * 고른 모델이 목록에 없으면(관리자가 닫았거나 회원에게 열려 있지 않으면)
 * null — 화면은 "다른 모델을 골라 주세요"라고 말합니다. 보낼 때는
 * 백엔드도 같은 이유로 거절합니다.
 */
export function currentModel(
  info: ChatInfo | null,
  chosenId: number | null,
): ChatModelOption | null {
  if (!info) return null;
  const id = chosenId ?? info.default_model_id;
  return info.models.find((model) => model.id === id) ?? null;
}

/** 답장 아래 작은 글씨로 보일 모델 이름. 모르는 ID면 빈 문자열. */
export function modelLabel(info: ChatInfo | null, modelId: string | null): string {
  if (!info || !modelId) return "";
  return info.models.find((model) => model.model_id === modelId)?.label ?? "";
}

/** 도구 토글(chat-plus-tools). 모델이 허용하지 않으면 백엔드가 400으로 거절합니다. */
export function setConversationTool(
  id: number,
  tool: ToolKind,
  enabled: boolean,
): Promise<Conversation> {
  const field =
    tool === "web_search"
      ? "use_web_search"
      : tool === "web_fetch"
        ? "use_web_fetch"
        : "use_code_execution";
  return request<Conversation>(`/chat/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ [field]: enabled }),
  });
}

export function renameConversation(id: number, title: string): Promise<Conversation> {
  return request<Conversation>(`/chat/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteConversation(id: number): Promise<void> {
  return request<void>(`/chat/conversations/${id}`, { method: "DELETE" });
}

/** 답장이 끝난 모양. 오류도 예외가 아니라 결과로 돌려줍니다. */
export type StreamOutcome =
  | {
      kind: "done";
      message: ChatMessage | null;
      chargedKrw: number;
      longHistory?: LongHistory | null;
      /** 답장이 실제로 쓴 토큰(장부). 아무것도 쓰지 않았으면 null. */
      usage?: ReplyUsage | null;
      /** 차감 직후 남은 동아리 지원(원). 차감이 없었으면 null. */
      walletRemainingKrw?: number | null;
    }
  | { kind: "error"; detail: string }
  | { kind: "stopped" };

export interface StreamHandlers {
  onStart?: (userMessage: ChatMessage, estimate: StreamEstimate | null) => void;
  onDelta?: (text: string) => void;
  /** 서버 도구가 돌기 시작했거나 끝났을 때 — "검색 중…" 줄의 재료. */
  onTool?: (kind: ToolKind, status: "running" | "done" | "error") => void;
}

/**
 * 메시지를 보내고 답장을 끝까지 읽습니다.
 *
 * `signal`을 abort하면 연결이 끊기고, 백엔드는 그 순간까지 만든 답장을
 * 저장하고 쓴 만큼만 차감합니다. 이때 결과는 `{ kind: "stopped" }`입니다.
 *
 * 스트림이 시작되기 전에 거절되면 `ApiError`를 던집니다 — `request()`와
 * 같은 모양이라 화면이 `describeError`로 그대로 보여 줄 수 있습니다.
 */
export async function sendMessage(
  conversationId: number,
  content: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<StreamOutcome> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/chat/conversations/${conversationId}/messages`, {
      method: "POST",
      signal,
      cache: "no-store",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (error) {
    if (signal.aborted) return { kind: "stopped" };
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
  let outcome: StreamOutcome | null = null;

  const handle = (block: string) => {
    let name = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) name = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!name || !data) return;
    const payload = JSON.parse(data);
    if (name === "start") handlers.onStart?.(payload.user_message, payload.estimate ?? null);
    else if (name === "delta") handlers.onDelta?.(payload.text);
    else if (name === "tool") handlers.onTool?.(payload.kind, payload.status);
    else if (name === "done")
      outcome = {
        kind: "done",
        message: payload.message,
        chargedKrw: payload.charged_krw,
        longHistory: payload.long_history ?? null,
        usage: payload.usage ?? null,
        walletRemainingKrw: payload.wallet_remaining_krw ?? null,
      };
    else if (name === "error") outcome = { kind: "error", detail: payload.detail };
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
    if (signal.aborted) return { kind: "stopped" };
    return { kind: "error", detail: "답장을 받는 중에 연결이 끊어졌습니다. 다시 보내 주세요." };
  }

  if (buffer.trim()) handle(buffer);
  if (signal.aborted) return { kind: "stopped" };
  return (
    outcome ?? { kind: "error", detail: "답장이 끝까지 오지 않았습니다. 다시 보내 주세요." }
  );
}

/** 액션 단추가 여는 주소. 회원이 한 말을 아이디어로 그대로 들고 갑니다. */
export function actionHref(action: ChatAction, idea: string, title: string): string {
  const base = action === "builder" ? "/builder" : "/video";
  const params = new URLSearchParams({ idea });
  if (title) params.set("name", title);
  return `${base}?${params.toString()}`;
}

export const ACTION_LABEL: Record<ChatAction, string> = {
  builder: "Project Builder에서 예시 앱 만들기",
  video: "Video Generator 열기",
};
