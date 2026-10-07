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
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
}

export interface ChatInfo {
  is_mock: boolean;
  rate_limit_per_minute: number;
  max_message_length: number;
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

export function createConversation(): Promise<Conversation> {
  return request<Conversation>("/chat/conversations", {
    method: "POST",
    body: JSON.stringify({}),
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
  | { kind: "done"; message: ChatMessage | null; chargedKrw: number }
  | { kind: "error"; detail: string }
  | { kind: "stopped" };

export interface StreamHandlers {
  onStart?: (userMessage: ChatMessage) => void;
  onDelta?: (text: string) => void;
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
    if (name === "start") handlers.onStart?.(payload.user_message);
    else if (name === "delta") handlers.onDelta?.(payload.text);
    else if (name === "done")
      outcome = { kind: "done", message: payload.message, chargedKrw: payload.charged_krw };
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
  builder: "Project Builder에서 시작",
  video: "Video Generator 열기",
};
