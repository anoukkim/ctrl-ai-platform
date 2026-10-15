/**
 * CTRL+AI 기능 상자 — 사이트 쪽 API (app-platform P2).
 *
 * 앱의 연결(허용) 화면과 Profile › 연결된 앱, 그리고 관리자의 기능 상자
 * 정지/재개. 앱 안에서 쓰는 SDK(ctrlai.*)는 apps 주소에 있고, 여기에는
 * 없습니다.
 */

import { request } from "./http";

export interface AppScope {
  key: string;
  label: string;
}

export interface ConnectInfo {
  name: string;
  owner_name: string;
  mode: "app" | "preview";
  scopes: AppScope[];
  ai_estimate_krw: number | null;
  call_cap_krw: number;
  connected: boolean;
}

export interface AppConsent {
  id: number;
  app_name: string;
  app_url: string | null;
  scopes: AppScope[];
  granted_at: string;
}

export function getConnectInfo(slug: string): Promise<ConnectInfo> {
  return request<ConnectInfo>(`/app-connect/${encodeURIComponent(slug)}`);
}

/** 허용: 동의를 남기고, 창이 갈 다음 주소(앱의 callback)를 받습니다. */
export function allowApp(slug: string, state: string): Promise<{ redirect_url: string }> {
  return request<{ redirect_url: string }>(`/app-connect/${encodeURIComponent(slug)}`, {
    method: "POST",
    body: JSON.stringify({ state }),
  });
}

export function listAppConsents(): Promise<AppConsent[]> {
  return request<AppConsent[]>("/me/app-consents");
}

export function revokeAppConsent(id: number): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/me/app-consents/${id}/revoke`, { method: "POST", body: "{}" });
}

/** 관리자: 앱 하나의 기능 상자를 멈추거나 다시 켭니다 (감사 기록). */
export function setAppSdk(projectId: number, enabled: boolean, reason = ""): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/admin/apps/${projectId}/sdk`, {
    method: "POST",
    body: JSON.stringify({ enabled, reason }),
  });
}

/** 앱 주소(slug)의 모양 — 연결 화면이 받는 값을 거릅니다. */
export const SLUG_PATTERN = /^[a-z2-9]{10}$/;
