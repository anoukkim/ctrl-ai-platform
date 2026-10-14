/**
 * 이 배포가 어떤 곳인지 — 베타인지, 어느 화면이 아직 테스트 모드인지.
 *
 * 프런트엔드 이미지는 한 번 만들어 어디서든 돌 수 있으므로, 스스로
 * 정하지 않고 백엔드에 묻습니다(`GET /api/site`). 백엔드는 실행할 때의
 * APP_ENV와 제공자 설정으로 답합니다.
 */

import { request } from "./http";

/** "테스트 모드" 표시를 붙일 화면. 백엔드의 app/schemas/site.py와 짝입니다. */
export type TestModeArea = "chat" | "builder" | "video" | "community";

export interface SiteInfo {
  environment: string;
  is_development: boolean;
  is_beta: boolean;
  /** 회원가입 화면의 "정보가 어디에 저장되는지" 안내. 서버 .env에서 고칩니다. */
  data_location_notice: string;
  top_ups_enabled: boolean;
  /** "Google로 계속하기"를 보여 줄지 (google-login). */
  google_login: boolean;
  /**
   * 회원 앱이 도는 주소(https://apps.ctrlai.my) — builder-static-runtime.
   * 없으면(null) 미리보기는 파일을 이 페이지 안에서 바로 돌립니다.
   */
  apps_base_url?: string | null;
  test_mode: Record<TestModeArea, boolean>;
}

/**
 * 답을 받기 전, 또는 받지 못했을 때.
 *
 * 아무것도 덧붙이지 않는 쪽으로 둡니다 — 배너도, 테스트 모드 표시도
 * 없습니다. 실제 차단(충전 거절 등)은 어차피 백엔드가 합니다.
 */
export const UNKNOWN_SITE: SiteInfo = {
  environment: "",
  is_development: false,
  is_beta: false,
  data_location_notice: "",
  // personal-topup-off: 기본은 꺼짐 — /api/site가 켜져 있다고 말할 때만 켭니다.
  top_ups_enabled: false,
  google_login: false,
  apps_base_url: null,
  test_mode: { chat: false, builder: false, video: false, community: false },
};

export function fetchSite(): Promise<SiteInfo> {
  return request<SiteInfo>("/site");
}

/** 화면마다 다른 테스트 모드 문구. */
export const TEST_MODE_LABEL: Record<TestModeArea, string> = {
  chat: "테스트 모드 – 실제 AI 결과가 아닙니다",
  builder: "테스트 모드 – 실제 AI 결과가 아닙니다",
  video: "테스트 모드 – 실제 AI 결과가 아닙니다",
  community: "테스트 모드 – 실제 회원 작품이 아닌 예시입니다",
};

// ------------------------------------------------------------------ 의견 보내기

export const FEEDBACK_MAX_LENGTH = 2000;

export interface FeedbackItem {
  id: number;
  body: string;
  page: string;
  created_at: string;
}

export interface FeedbackAdminItem extends FeedbackItem {
  user_id: number | null;
  username: string | null;
  display_name: string | null;
}

export function sendFeedback(body: string, page: string): Promise<FeedbackItem> {
  return request<FeedbackItem>("/feedback", {
    method: "POST",
    body: JSON.stringify({ body, page }),
  });
}

export function listFeedback(): Promise<FeedbackAdminItem[]> {
  return request<FeedbackAdminItem[]>("/admin/feedback");
}
