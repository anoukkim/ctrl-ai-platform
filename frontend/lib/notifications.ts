/**
 * 회원 알림 (feat-notifications, owner-polish 2; owner-polish-3 (c)·(c2)로 줄임).
 *
 * 서버가 실제로 일어난 일에서만 만듭니다 — 게시 완료, 참여 신청 승인·거절,
 * 반응을 얻었어요(내 영상의 반응·댓글, 항목마다 하루 한 줄), 내 앱의 신고
 * 처리. 지원금 사용 요약과 이정표는 더 이상 알림이 아닙니다(토스트가 말해요).
 * 브라우저는 읽고 지울 뿐, 알림을 만들지 않습니다. 종을 열면 숫자가 사라지고
 * (보이는 것을 읽음으로), 지우기는 보이는 알림을 지웁니다 — 기록은 남기지
 * 않아요.
 */

import { request } from "./http";

export type NotificationKind = "publish" | "application" | "reaction" | "app_report";

export interface Notification {
  id: number;
  kind: NotificationKind | string;
  title: string;
  body: string;
  /** 눌렀을 때 가는 곳 — 사이트 안 경로. null이면 아무 데도 안 갑니다. */
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NotificationList {
  items: Notification[];
  unread: number;
}

/** 목록을 읽습니다 — 서버가 이때 90일 지난 것을 지우고 어제까지의 사용 요약을 씁니다. */
export function listNotifications(): Promise<NotificationList> {
  return request<NotificationList>("/notifications");
}

export function unreadCount(): Promise<{ unread: number }> {
  return request<{ unread: number }>("/notifications/unread");
}

export function markRead(id: number): Promise<Notification> {
  return request<Notification>(`/notifications/${id}/read`, { method: "POST", body: JSON.stringify({}) });
}

export function markAllRead(): Promise<{ unread: number }> {
  return request<{ unread: number }>("/notifications/read-all", { method: "POST", body: JSON.stringify({}) });
}

/** 지우기 (owner-polish-3 (c2)): 보이는 알림(ids)을, 없으면 내 것 전부를 지웁니다. */
export function clearNotifications(ids?: number[]): Promise<{ unread: number }> {
  return request<{ unread: number }>("/notifications/clear", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) });
}

/**
 * 종과 Profile의 목록이 서로를 새로 고치는 신호. 한쪽에서 읽음으로 표시하면
 * 다른 쪽도 숫자를 다시 받습니다 (같은 창 안에서만).
 */
export const NOTIFICATIONS_CHANGED = "ctrlai:notifications-changed";

/** `source`는 보낸 쪽의 이름 — 자기 신호에 자기가 다시 불러오지 않도록. */
export function announceNotificationsChanged(source: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED, { detail: { source } }));
  }
}

export function changedElsewhere(event: Event, me: string): boolean {
  return (event as CustomEvent<{ source?: string }>).detail?.source !== me;
}

/** 종류별 짧은 표시 — 아이콘 대신 글자 하나. 화면 읽기에는 숨깁니다. */
export const KIND_GLYPH: Record<string, string> = {
  publish: "📣",
  application: "✅",
  reaction: "💬",
  app_report: "🚩",
};
