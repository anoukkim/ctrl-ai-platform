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

import type { ChatAttachment } from "./chat-files";
import { API_BASE_URL, ApiError } from "./api";
import type { DepthLevel, DepthOption, PickerModel } from "./depth";
import { request } from "./http";

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  last_message_at: string;
  /** 다음 답장이 쓸 모델(`ChatModelOption.id`). null이면 기본 모델. */
  chat_model_id: number | null;
  /** 생각 깊이(quality-tuning Q1). null이면 보통. 숫자는 서버가 정합니다. */
  depth?: DepthLevel | null;
  /** 서버 도구 토글(chat-plus-tools). 모델이 허용할 때만 실제로 쓰입니다. */
  use_web_search?: boolean;
  use_web_fetch?: boolean;
  use_code_execution?: boolean;
  /** 생각 과정 보기(chat-thinking-view). 이후 답장부터 적용됩니다. */
  show_thinking?: boolean;
}

/** 서버 도구 한 가지. */
export type ToolKind = "web_search" | "web_fetch" | "code_execution";

/** 답장이 인용한 출처 하나 — 번호 달린 링크로 보여 줍니다. */
export interface ReplySource {
  title: string;
  url: string;
  /** 답장 본문이 인용한 출처 — 앞에 옵니다(fix-real-web-search). */
  cited?: boolean;
}

/** 처음에 보여 줄 출처 수. 나머지는 "더 보기"로. */
export const SOURCES_VISIBLE = 8;

/**
 * 화면에 보일 출처: 주소가 같으면 하나로(끝의 / 와 #은 무시), 인용한 것이
 * 먼저. 백엔드가 이미 정리해 두지만, 예전에 저장된 답장도 같은 모양이
 * 되도록 여기서 한 번 더 합니다.
 */
export function tidySources(sources: ReplySource[]): ReplySource[] {
  const seen = new Map<string, ReplySource>();
  for (const source of sources) {
    const key = source.url.split("#")[0].replace(/\/+$/, "");
    const known = seen.get(key);
    if (!known) seen.set(key, { ...source });
    else {
      if (!known.title && source.title) known.title = source.title;
      if (source.cited) known.cited = true;
    }
  }
  const all = [...seen.values()];
  return [...all.filter((s) => s.cited), ...all.filter((s) => !s.cited)];
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
  /** 답장을 쓴 생각 깊이(quality-tuning Q1). 깊이가 없는 모델이면 null. */
  depth?: string | null;
  /** 답장이 1회 비용 한도에 닿아 멈췄다면 그 한도(원). 아니면 null. */
  capped_krw?: number | null;
  /** 답장의 영수증 — 장부의 숫자. 대화를 다시 열어도 그대로 옵니다. */
  receipt?: ReplyReceipt | null;
  /** 웹 검색이 인용한 출처(chat-plus-tools). 도구를 안 썼으면 null. */
  sources?: ReplySource[] | null;
  /** Claude의 생각 과정 요약(chat-thinking-view). 보기만 할 뿐 Claude에게 다시 보내지 않습니다. */
  thinking?: string | null;
  /** 이 메시지에 붙인 파일(chat-plus-files). 바이트가 아니라 정보만. */
  attachments?: ChatAttachment[];
  created_at: string;
  /** 몇 번의 호출로 쓴 답장인지(feat-auto-continue). 1이면 한 번. */
  segments?: number;
  /** 서버가 이어 쓰기를 멈춘 이유(전체 한도·지갑·오류). 끝까지 썼으면 null. */
  stop_note?: string | null;
}

/** 답장 하나가 실제로 쓴 토큰. 캐시 칸은 캐시가 꺼져 있으면 null입니다. */
export interface ReplyUsage extends ReplyWonSplit {
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number | null;
  cache_read_tokens: number | null;
  /** 청구된 웹 검색 횟수와 그 요금(원). 0이면 검색 줄이 없습니다. */
  web_search_count?: number;
  tool_fee_krw?: number;
  /** 생각 과정 보기를 켜고 쓴 답장 — 출력에 생각 토큰이 들어 있습니다. */
  thinking_shown?: boolean;
}

/** 답장 아래 영수증(live-cost-display). 합계는 장부가 차감한 금액입니다. */
export interface ReplyReceipt extends ReplyUsage {
  charged_krw: number;
}

/**
 * 같은 답장을 원 단위 항목으로 나눈 값(cost-clarity). 반올림 전 값이라
 * 더하면 합계보다 1원 안쪽으로 작을 수 있습니다. 예전 서버라면 없습니다.
 */
export interface ReplyWonSplit {
  input_krw?: number | null;
  cache_write_krw?: number | null;
  cache_read_krw?: number | null;
  output_krw?: number | null;
  tool_krw?: number | null;
  /** 캐시로 읽은 부분을 그냥 입력으로 보냈다면 더 들었을 금액. */
  cache_saved_krw?: number | null;
  /** 옛 답장이라 지금 요금표로 다시 계산한 값. */
  split_estimated?: boolean;
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
  /** "도구" 판의 가격(fix-composer-toolbar): 페이지 읽기 1회, 코드 실행 1회, 원. */
  web_fetch_krw_per_use?: number | null;
  code_execution_krw_per_use?: number | null;
  /**
   * 생각 과정 보기가 답장 1회에 더하는 어림값(원). 0이면 추가 비용 없음
   * (Opus는 원래 생각합니다), null이면 환율이 없어 모릅니다.
   */
  thinking_extra_krw?: number | null;
  thinking_basis?: "recent" | "formula";
  /** 생각 깊이 막대(quality-tuning Q1). 비어 있으면 깊이 조절이 없는 모델. */
  levels?: DepthOption[];
  flat_max_krw?: number;
  depth_note?: string;
}

export interface ChatInfo {
  is_mock: boolean;
  rate_limit_per_minute: number;
  max_message_length: number;
  /** 웹 페이지 읽기의 현재 한도 — 토글 안내문이 그대로 보여 줍니다. */
  web_fetch_max_uses: number;
  /** 웹 검색: 한 답장에 최대 몇 회(관리자 설정, fix-real-web-search). */
  web_search_max_uses?: number;
  web_fetch_max_content_tokens: number;
  models: ChatModelOption[];
  /** 새 대화가 쓰는 모델. 모델 목록이 비었을 때만 null. */
  default_model_id: number | null;
  /** 회원의 기본값(Profile › 기본 모델, quality-tuning Q1). */
  member_default_model_id?: number | null;
  member_default_depth?: DepthLevel;
}

/** Chat의 모델 줄을 공용 고르기 창의 모양으로. */
export function toPickerModel(model: ChatModelOption): PickerModel {
  return {
    id: model.id,
    label: model.label,
    description: model.description,
    admin_only: model.admin_only,
    is_default: model.is_default,
    estimate_krw: model.estimated_reply_krw,
    estimate_basis: model.estimate_basis,
    levels: model.levels ?? [],
    flat_max_krw: model.flat_max_krw ?? 0,
    depth_note: model.depth_note ?? "",
  };
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
/** 새 대화 화면에서 미리 고른 도구(fix-new-chat-tools). 첫 메시지 때 함께 보냅니다. */
export interface NewConversationTools {
  use_web_search?: boolean;
  use_web_fetch?: boolean;
  use_code_execution?: boolean;
  show_thinking?: boolean;
}

export function createConversation(
  chatModelId: number | null = null,
  tools: NewConversationTools = {},
  depth: DepthLevel | null = null,
): Promise<Conversation> {
  return request<Conversation>("/chat/conversations", {
    method: "POST",
    body: JSON.stringify({
      ...(chatModelId === null ? {} : { chat_model_id: chatModelId }),
      ...(depth === null ? {} : { depth }),
      ...tools,
    }),
  });
}

/**
 * 대화의 모델과 생각 깊이를 바꿉니다. 이후 답장부터 적용되고, 지난 답장은
 * 그대로입니다. 깊이는 이름만 보냅니다 — 숫자는 서버가 정합니다.
 */
export function setConversationModel(
  id: number,
  chatModelId: number,
  depth: DepthLevel | null = null,
): Promise<Conversation> {
  return request<Conversation>(`/chat/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ chat_model_id: chatModelId, ...(depth === null ? {} : { depth }) }),
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
  // 고른 것이 없으면 회원의 기본값, 그것도 없으면 목록의 기본(quality-tuning Q1).
  const id = chosenId ?? info.member_default_model_id ?? info.default_model_id;
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

/** 생각 과정 보기 토글(chat-thinking-view). 이후 답장부터 적용됩니다. */
export function setConversationThinking(id: number, enabled: boolean): Promise<Conversation> {
  return request<Conversation>(`/chat/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ show_thinking: enabled }),
  });
}

/** 토글 옆 가격 문구 — 미리 보여 주는 값입니다. */
export function thinkingPriceLabel(model: ChatModelOption | null): string {
  const extra = model?.thinking_extra_krw;
  if (extra === 0) return "추가 비용 없음";
  if (extra === null || extra === undefined) return "비용이 조금 더 듭니다";
  return `답장마다 +약 ${extra.toLocaleString("ko-KR")}원`;
}

/** 생각 과정 요약을 단계(문단)로 나눕니다. 빈 문단은 버립니다. */
export function thinkingSteps(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
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
      /** 몇 번의 호출로 쓴 답장인지(feat-auto-continue). */
      segments?: number;
      /** 서버가 이어 쓰기를 멈춘 이유(전체 한도·지갑). 끝까지 썼으면 null. */
      stopNote?: string | null;
    }
  /** 백엔드가 보낸 실패 — 이때만 아무것도 차감되지 않은 것이 확실합니다. */
  | { kind: "error"; detail: string }
  /**
   * 우리 쪽에서 스트림이 끊겼습니다(연결 손실, 끝나지 않은 응답).
   * 백엔드의 produce 작업은 계속 돌아 그때까지 만든 답장을 저장하고 쓴
   * 만큼 차감하므로, **청구가 없었다고 말하면 안 됩니다** — 중지와 같이
   * 다룹니다.
   */
  | { kind: "disconnected"; detail: string }
  | { kind: "stopped" };

export interface StreamHandlers {
  onStart?: (userMessage: ChatMessage, estimate: StreamEstimate | null) => void;
  onDelta?: (text: string) => void;
  /** 생각 과정 요약 조각(chat-thinking-view) — 답장보다 먼저 옵니다. */
  onThinking?: (text: string) => void;
  /**
   * 서버 도구가 돌기 시작했거나 끝났을 때 — "검색 중…" 줄의 재료.
   * 끝난 사용은 방금 더해진 비용(원)을 함께 들고 와서, 흐르는 약 N원이
   * 그 순간 눈에 띄게 뜁니다. 정산은 영수증(장부)이 합니다.
   */
  onTool?: (
    kind: ToolKind,
    status: "running" | "done" | "error",
    addedKrw?: number,
  ) => void;
  /**
   * 답장이 1회 한도에 닿아 서버가 **스스로 이어 쓰기** 시작했습니다
   * (feat-auto-continue): 몇 번째 호출인지, 지금까지 차감된 금액, 이 호출의
   * 어림값 재료. 화면은 "이어서 쓰는 중… 지금까지 N원"을 보여 줍니다.
   */
  onContinue?: (segment: number, chargedSoFarKrw: number, estimate: StreamEstimate | null) => void;
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
  /** 이 대화에 올려 두고 아직 보내지 않은 파일(chat-plus-files). */
  attachmentIds: number[] = [],
): Promise<StreamOutcome> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/chat/conversations/${conversationId}/messages`, {
      method: "POST",
      signal,
      cache: "no-store",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify(
        attachmentIds.length > 0 ? { content, attachment_ids: attachmentIds } : { content },
      ),
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
    else if (name === "thinking") handlers.onThinking?.(payload.text);
    else if (name === "tool")
      handlers.onTool?.(payload.kind, payload.status, payload.added_krw ?? 0);
    else if (name === "continue")
      handlers.onContinue?.(payload.segment, payload.charged_so_far_krw ?? 0, payload.estimate ?? null);
    else if (name === "done")
      outcome = {
        kind: "done",
        message: payload.message,
        chargedKrw: payload.charged_krw,
        longHistory: payload.long_history ?? null,
        usage: payload.usage ?? null,
        walletRemainingKrw: payload.wallet_remaining_krw ?? null,
        // feat-auto-continue: only when the server sent them (older bodies have neither).
        ...(payload.segments != null ? { segments: payload.segments } : {}),
        ...(payload.stop_note ? { stopNote: payload.stop_note } : {}),
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
    // 서버가 아니라 연결이 실패했습니다 — 차감이 있었을 수 있습니다.
    return { kind: "disconnected", detail: "답장을 받는 중에 연결이 끊어졌습니다." };
  }

  if (buffer.trim()) handle(buffer);
  if (signal.aborted) return { kind: "stopped" };
  return outcome ?? { kind: "disconnected", detail: "답장이 끝까지 오지 않았습니다." };
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
