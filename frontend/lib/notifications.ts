/**
 * 회원 알림 목록 (feat-notifications, owner-polish 2).
 *
 * 서버가 실제로 일어난 일에서만 만듭니다 — 게시 완료, 참여 신청 승인,
 * 지원금 사용 요약(하루 한 줄), 이정표, 내 앱의 신고 처리. 브라우저는
 * 읽고 "읽음"으로 표시할 뿐, 알림을 만들지 않습니다.
 */

import { request } from "./http";

export type NotificationKind = "publish" | "application" | "spend" | "milestone" | "app_report";

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

/**
 * 종과 Profile의 목록이 서로를 새로 고치는 신호. 한쪽에서 읽음으로 표시하면
 * 다른 쪽도 숫자를 다시 받습니다 (같은 창 안에서만).
 */
export const NOTIFICATIONS_CHANGED = "ctrlai:notifications-changed";

export function announceNotificationsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

/** 종류별 짧은 표시 — 아이콘 대신 글자 하나. 화면 읽기에는 숨깁니다. */
export const KIND_GLYPH: Record<string, string> = {
  publish: "📣",
  application: "✅",
  spend: "💸",
  milestone: "🏁",
  app_report: "🚩",
};
