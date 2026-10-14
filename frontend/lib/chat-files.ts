/**
 * Chat 첨부 파일 (chat-plus-files) — 이미지, PDF, CSV, 텍스트.
 *
 * 파일 하나는 요청 하나로 올립니다: 본문은 파일의 바이트, 이름은 `?name=`.
 * 형식은 백엔드가 **바이트로** 판단합니다(확장자가 아니라). 여기서 미리 보는
 * 확장자·크기는 서버까지 다녀오지 않으려는 안내일 뿐이고, 거절의 기준은
 * 백엔드의 한국어 문장입니다.
 *
 * `application/octet-stream`으로 보냅니다 — 다른 출처의 페이지가 미리
 * 확인(preflight) 없이 보낼 수 있는 형식은 백엔드가 받지 않습니다(CLAUDE.md §2).
 */

import { API_BASE_URL, ApiError } from "./api";
import { request } from "./http";

export type AttachmentKind = "image" | "pdf" | "csv" | "text";

export interface ChatAttachment {
  id: number;
  kind: AttachmentKind;
  name: string;
  size: number;
  media_type: string;
  page_count: number | null;
  width: number | null;
  height: number | null;
  /** 어림 토큰 — 입력창의 예상 비용과 백엔드의 사전 확인이 같은 숫자를 씁니다. */
  estimated_tokens: number;
  message_id: number | null;
}

export interface AttachmentEstimate {
  tokens: number;
  /** "첨부 포함 답장 1회 약 N원" */
  with_files_krw: number | null;
  /** "이어지는 답장마다 약 M원씩 더" */
  each_later_krw: number | null;
}

export interface AttachmentUploaded {
  attachment: ChatAttachment;
  estimate: AttachmentEstimate;
}

/** 파일 고르기 창에 걸 확장자. 진짜 판단은 백엔드가 바이트로 합니다. */
export const ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.pdf,.csv,.txt,.md";
export const MAX_FILES = 5;
const MB = 1024 * 1024;

/** 올리기 전에 알 수 있는 것만 미리 말합니다(서버가 다시 확인). */
export function precheck(file: File): string | null {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (![".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf", ".csv", ".txt", ".md"].includes(ext)) {
    return "지원하지 않는 형식입니다 (JPEG, PNG, WebP, GIF, PDF, CSV, TXT, MD만 올릴 수 있습니다).";
  }
  const limit = [".csv", ".txt", ".md"].includes(ext) ? 1 : 10;
  if (file.size > limit * MB) return `파일이 너무 큽니다 (최대 ${limit}MB).`;
  return null;
}

export async function uploadAttachment(
  conversationId: number,
  file: File,
): Promise<AttachmentUploaded> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/chat/conversations/${conversationId}/attachments?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/octet-stream" },
        body: file,
      },
    );
  } catch {
    throw new ApiError("서버에 연결할 수 없습니다", 0);
  }
  if (!response.ok) {
    let detail = `파일을 올리지 못했습니다 (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      /* 기본 문구 */
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as AttachmentUploaded;
}

export function getPendingAttachments(conversationId: number): Promise<ChatAttachment[]> {
  return request<ChatAttachment[]>(`/chat/conversations/${conversationId}/attachments/pending`);
}

export function getAttachmentEstimate(conversationId: number): Promise<AttachmentEstimate> {
  return request<AttachmentEstimate>(`/chat/conversations/${conversationId}/attachments/estimate`);
}

export function deleteAttachment(attachmentId: number): Promise<void> {
  return request<void>(`/chat/attachments/${attachmentId}`, { method: "DELETE" });
}

/** 저장된 사본 — 썸네일과 내려받기. 자기 파일만 열립니다(남의 것은 404). */
export function attachmentUrl(attachmentId: number): string {
  return `${API_BASE_URL}/api/chat/attachments/${attachmentId}/file`;
}

/** 1.2MB / 340KB */
export function formatSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 파일을 보낼 때 함께 보여 주는 안내 — 어디로 가고 언제까지 남는지. */
export const FILE_PRIVACY_NOTE =
  "파일은 답장을 위해 Anthropic(Claude)에 보내지고, 이 대화를 지울 때까지 보관됩니다. 다른 사람의 개인 정보가 담긴 파일은 올리지 마세요.";
