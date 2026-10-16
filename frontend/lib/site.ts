/**
 * 이 배포가 어떤 곳인지 — 베타인지, 어느 화면이 아직 테스트 모드인지.
 *
 * 프런트엔드 이미지는 한 번 만들어 어디서든 돌 수 있으므로, 스스로
 * 정하지 않고 백엔드에 묻습니다(`GET /api/site`). 백엔드는 실행할 때의
 * APP_ENV와 제공자 설정으로 답합니다.
 */

import { API_BASE_URL } from "./api";
import { request, uploadBytes } from "./http";

/** "테스트 모드" 표시를 붙일 화면. 백엔드의 app/schemas/site.py와 짝입니다. */
export type TestModeArea = "chat" | "builder" | "video" | "community";

export interface SiteInfo {
  environment: string;
  is_development: boolean;
  is_beta: boolean;
  /** 회원가입 화면의 "정보가 어디에 저장되는지" 안내. 서버 .env에서 고칩니다. */
  data_location_notice: string;
  top_ups_enabled: boolean;
  /** Builder의 GitHub 배지·버튼 (Phase 4). 꺼져 있으면 아예 보이지 않아요. */
  github_enabled?: boolean;
  /** "Google로 계속하기"를 보여 줄지 (google-login). */
  google_login: boolean;
  /**
   * 회원 앱이 도는 주소(https://apps.ctrlai.my) — builder-static-runtime.
   * 없으면(null) 미리보기는 파일을 이 페이지 안에서 바로 돌립니다.
   */
  apps_base_url?: string | null;
  /**
   * 회원이 Video Generator를 쓸 수 있는지 (owner-polish 6). 관리자가
   * Admin › System에서 켭니다. 기본은 잠김 — 메뉴와 화면이 "다음 단계에서
   * 열려요"라고 말합니다 (오너, 2026-10-16: 가운데 자물쇠 하나 + 짧은 안내).
   */
  video_open?: boolean;
  test_mode: Record<TestModeArea, boolean>;
}

/** Video Generator가 잠겨 있을 때 회원이 보는 한 문장. */
export const VIDEO_LOCKED_HINT = "다음 단계에서 열려요";

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
  github_enabled: false,
  google_login: false,
  apps_base_url: null,
  // owner-polish 6: 기본은 잠김 — /api/site가 열렸다고 말할 때만 엽니다.
  video_open: false,
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

/** 의견에 붙이는 스크린샷 — 한 의견에 최대 3장, 1장 5MB 이하 (feedback-screenshots). */
export const FEEDBACK_MAX_IMAGES = 3;
export const FEEDBACK_IMAGE_MAX_MB = 5;
export const FEEDBACK_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** 파일 고르기 창에 걸 종류. 휴대폰은 이것으로 사진 보관함을 엽니다. */
export const FEEDBACK_IMAGE_ACCEPT = FEEDBACK_IMAGE_TYPES.join(",");
export const FEEDBACK_IMAGE_UNSUPPORTED = "PNG, JPG, WebP 이미지만 올릴 수 있어요.";
export const FEEDBACK_IMAGE_TOO_BIG = `사진이 너무 커요 (1장 ${FEEDBACK_IMAGE_MAX_MB}MB 이하).`;
export const FEEDBACK_IMAGES_TOO_MANY = `사진은 ${FEEDBACK_MAX_IMAGES}장까지 붙일 수 있어요.`;
/** 붙이기 전에 한 줄로 — 화면에 보이는 남의 정보까지 운영진에게 가므로. */
export const FEEDBACK_IMAGE_PRIVACY_NOTE = "화면에 개인정보가 보이면 가린 뒤 올려 주세요.";

export interface FeedbackImage {
  id: number;
  name: string;
  size: number;
  width: number;
  height: number;
  media_type: string;
}

export interface FeedbackItem {
  id: number;
  body: string;
  page: string;
  created_at: string;
  images: FeedbackImage[];
}

export interface FeedbackAdminItem extends FeedbackItem {
  user_id: number | null;
  username: string | null;
  display_name: string | null;
}

/** 올리기 전에 알 수 있는 것만 미리 말합니다 — 진짜 판단은 백엔드가 바이트로 합니다. */
export function precheckFeedbackImage(file: File): string | null {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  const byType = FEEDBACK_IMAGE_TYPES.includes(file.type);
  const byName = [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
  if (!byType && !byName) return FEEDBACK_IMAGE_UNSUPPORTED;
  if (file.size > FEEDBACK_IMAGE_MAX_MB * 1024 * 1024) return FEEDBACK_IMAGE_TOO_BIG;
  return null;
}

/**
 * 붙여넣은 스크린샷은 이름이 없거나 `image.png`뿐입니다. 서버는 바이트와
 * 확장자가 맞는지 보므로, 종류에 맞는 이름을 붙여 보냅니다.
 */
export function feedbackImageName(file: File, index: number): string {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return file.name;
  const byType: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  return `screenshot-${index + 1}.${byType[file.type] ?? "png"}`;
}

/** 스크린샷 하나를 올립니다 — 본문은 파일의 바이트, 이름은 `?name=` (`uploadBytes`). */
export function uploadFeedbackImage(file: File, name: string): Promise<FeedbackImage> {
  return uploadBytes<FeedbackImage>("/feedback/images", file, name, "사진을 올리지 못했어요");
}

/** 아직 보내지 않은 스크린샷을 뺍니다(✕, 창 닫기). */
export function deleteFeedbackImage(imageId: number): Promise<void> {
  return request<void>(`/feedback/images/${imageId}`, { method: "DELETE" });
}

export function sendFeedback(body: string, page: string, imageIds: number[] = []): Promise<FeedbackItem> {
  return request<FeedbackItem>("/feedback", {
    method: "POST",
    body: JSON.stringify({ body, page, image_ids: imageIds }),
  });
}

export function listFeedback(): Promise<FeedbackAdminItem[]> {
  return request<FeedbackAdminItem[]>("/admin/feedback");
}

/** 저장된 스크린샷 — 관리자만 열립니다(회원은 403). */
export function feedbackImageUrl(imageId: number): string {
  return `${API_BASE_URL}/api/admin/feedback/images/${imageId}/file`;
}

/** 의견을 지웁니다 — 사진도 함께. 감사 기록에 남습니다. */
export function deleteFeedback(feedbackId: number): Promise<void> {
  return request<void>(`/admin/feedback/${feedbackId}`, { method: "DELETE" });
}
