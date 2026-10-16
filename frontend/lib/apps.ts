/**
 * CtrlAIApps — 게시된 앱 (ctrlaiapps-publish).
 *
 * 목록과 상세는 백엔드가 고른 "게시된 버전"만 보여 줍니다. 만든 사람이
 * 계속 고치고 있어도 여기와 apps.ctrlai.my 주소에는 업데이트 게시 전까지
 * 바뀌지 않습니다.
 */

import { API_BASE_URL } from "./api";
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
  /** 게시된 버전의 ctrlai.json이 공유 목록을 선언했는지 — 상세의 안내 한 줄이 달라져요. */
  shared_lists: boolean;
  /** 내 즐겨찾기 (ui-improvements) — 내 목록에서 먼저 보여요. */
  favorite: boolean;
  /** 게시된 버전의 썸네일을 찍은 때. 없으면 표지를 그려요. */
  thumbnail_at?: string | null;
}

/** 게시된 앱의 썸네일 주소 — 찍은 때를 뒤에 붙여 새 그림이 바로 보이게. 없으면 null. */
export function appThumbnailUrl(app: Pick<AppListing, "slug" | "thumbnail_at">): string | null {
  if (!app.thumbnail_at) return null;
  return `${API_BASE_URL}/api/apps/${encodeURIComponent(app.slug)}/thumbnail?v=${encodeURIComponent(app.thumbnail_at)}`;
}

export function listApps(): Promise<AppListing[]> {
  return request<AppListing[]>("/apps");
}

/** Profile › 내가 만든 앱 — 내가 게시한 앱만 (owner-polish 3). */
export function listMyApps(): Promise<AppListing[]> {
  return request<AppListing[]>("/apps/mine");
}

export function getApp(slug: string): Promise<AppListing> {
  return request<AppListing>(`/apps/${encodeURIComponent(slug)}`);
}

/** 즐겨찾기 켜기/끄기 — 내 목록에서만 보이는 내 표시입니다. */
export function setAppFavorite(slug: string, on: boolean): Promise<AppListing> {
  return request<AppListing>(`/apps/${encodeURIComponent(slug)}/favorite`, {
    method: "POST",
    body: JSON.stringify({ on }),
  });
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
  /** 기능 상자(app-platform P2)가 켜져 있는지, 멈췄다면 그 이유. */
  sdk_enabled: boolean;
  sdk_disabled_reason: string;
  /** app-platform P3: 게시된 앱이 ctrlai.db에 가진 항목 수와 크기. */
  data_items: number;
  data_bytes: number;
}

/** Admin › Apps (app-platform P4b): AI through the 기능 상자, visitors and the maker's 미리보기 apart. */
export interface AdminAppAi {
  today_calls: number;
  today_krw: number;
  quarter_calls: number;
  quarter_krw: number;
  preview_quarter_calls: number;
  preview_quarter_krw: number;
}

/** 앱 하나 — 게시됐든 아니든, 기능 상자를 쓴 적이 있으면 보여요. */
export interface AdminAppOverview {
  id: number;
  name: string;
  published: boolean;
  slug: string | null;
  app_url: string | null;
  version_number: number | null;
  published_at: string | null;
  owner_id: number;
  owner_username: string;
  owner_name: string;
  example: boolean;
  sdk_enabled: boolean;
  sdk_disabled_reason: string;
  open_reports: number;
  consents: number;
  data_items: number;
  data_bytes: number;
  ai: AdminAppAi;
  updated_at: string | null;
}

export function listAdminAppOverview(): Promise<AdminAppOverview[]> {
  return request<AdminAppOverview[]>("/admin/apps/overview");
}

export function getAdminApp(projectId: number): Promise<AdminAppOverview> {
  return request<AdminAppOverview>(`/admin/apps/${projectId}`);
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
  /** app-platform P3: 공유 데이터 항목 하나에 대한 신고 — 그 내용 일부와 아직 있는지. */
  data_item_id: number | null;
  item_excerpt: string;
  item_live: boolean;
}

/** 앱 하나의 ctrlai.db — 목록별 크기와 공유 항목(관리자용, app-platform P3). */
export interface AdminDataCollection {
  name: string;
  kind: "private" | "shared";
  items: number;
  bytes: number;
}

export interface AdminDataItem {
  id: number;
  collection: string;
  data: Record<string, unknown>;
  size_bytes: number;
  author_username: string;
  created_at: string;
  open_reports: number;
}

export interface AdminData {
  items: number;
  bytes: number;
  collections: AdminDataCollection[];
  shared: AdminDataItem[];
}

export function getAdminAppData(projectId: number): Promise<AdminData> {
  return request<AdminData>(`/admin/apps/${projectId}/data`);
}

/** 관리자: 공유 항목 하나를 숨기거나(남김) 지웁니다(감사 기록). */
export function adminDataItem(
  itemId: number,
  action: "hide" | "delete",
  reason: string,
): Promise<{ detail: string; reports_closed: number }> {
  return request<{ detail: string; reports_closed: number }>(`/admin/apps/data/${itemId}/${action}`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** 1,234 B · 12.3 KB · 1.2 MB */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
