/**
 * CtrlAIApps — 게시된 앱 (ctrlaiapps-publish).
 *
 * 목록과 상세는 백엔드가 고른 "게시된 버전"만 보여 줍니다. 만든 사람이
 * 계속 고치고 있어도 여기와 apps.ctrlai.my 주소에는 업데이트 게시 전까지
 * 바뀌지 않습니다.
 */

import { request } from "./http";

export interface AppListing {
  id: number;
  /** 공개 폴더 이름 — 상세 화면 주소. */
  slug: string;
  name: string;
  description: string;
  /** 만든 사람 이름. 탈퇴한 회원이면 "탈퇴 회원". */
  author_name: string;
  author_username: string;
  version_number: number;
  published_at: string | null;
  /** 업데이트 메모 (선택). */
  publish_note: string;
  /** https://apps.ctrlai.my/<slug>/ — 앱 서버가 꺼져 있으면 null. */
  app_url: string | null;
}

export function listApps(): Promise<AppListing[]> {
  return request<AppListing[]>("/apps");
}

export function getApp(slug: string): Promise<AppListing> {
  return request<AppListing>(`/apps/${encodeURIComponent(slug)}`);
}

export function reportApp(slug: string, reason: string): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/apps/${encodeURIComponent(slug)}/report`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** 표지 색: 주소에서 늘 같은 색을 뽑습니다(같은 앱은 언제나 같은 색). */
export function coverHue(slug: string): number {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function coverTint(slug: string, angle = 140): string {
  const hue = coverHue(slug);
  return `linear-gradient(${angle}deg, oklch(0.42 0.09 ${hue}), oklch(0.3 0.07 ${(hue + 20) % 360}))`;
}

// ------------------------------------------------------------------ Admin › Content

export interface AdminApp extends AppListing {
  owner_id: number;
  open_reports: number;
  /** 관리자가 올린 예시 앱 — ZIP 미리보기를 열 수 있어요. */
  example: boolean;
}

export interface AdminReport {
  id: number;
  project_id: number;
  app_name: string;
  app_slug: string;
  reason: string;
  reporter_username: string;
  created_at: string;
  still_listed: boolean;
}

export function listAdminApps(): Promise<AdminApp[]> {
  return request<AdminApp[]>("/admin/apps");
}

export function listAppReports(): Promise<AdminReport[]> {
  return request<AdminReport[]>("/admin/apps/reports");
}

export function adminUnpublish(projectId: number, reason: string): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/admin/apps/${projectId}/unpublish`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function resolveAppReport(reportId: number, note: string): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/admin/apps/reports/${reportId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}
