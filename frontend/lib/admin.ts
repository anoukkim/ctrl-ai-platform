/**
 * Admin 화면 전용 읽기 API.
 *
 * 두 엔드포인트뿐이고 둘 다 읽기만 합니다. 바꾸는 호출은 전부
 * `quarters.ts`와 `projects.ts`에 이미 있습니다 — 여기에 다시 두면
 * 같은 일을 하는 함수가 두 곳에 생깁니다.
 *
 * 대시보드가 한 번의 호출로 모든 숫자를 받는 이유: 카드마다 따로
 * 불러오면 카드마다 다른 순간의 값을 보여 주게 됩니다.
 */

import { request } from "./http";

import type { Withdrawal } from "./account";
import type { AccountStatus } from "./auth";
import type {
  ApplicationStatus,
  AuditEntry,
  MembershipStatus,
  Quarter,
  QuarterAllocation,
  QuarterApplication,
  QuarterStatus,
  TopUp,
} from "./quarters";

export interface StatusCounts {
  /** 계정 상태별 — active / inactive / former */
  accounts: Partial<Record<AccountStatus, number>>;
  /** 이번 분기 참여 상태별. `none`은 참여 기록이 없는 회원입니다. */
  membership: Partial<Record<MembershipStatus | "none", number>>;
  total: number;
}

export interface AdminDashboard {
  quarter: Quarter | null;
  pending_applications: number;
  pending_top_ups: number;
  counts: StatusCounts;
  /** 구역 화면과 같은 함수에서 나온 숫자입니다. */
  members: MemberStats;
  applications: ApplicationStats;
  quarter_stats: QuarterStats | null;
  video_models_total: number;
  video_models_member_visible: number;
  recent_audit: AuditEntry[];
  /** 개발 환경에서만 true. 개발 도구를 보일지 정합니다. */
  is_development: boolean;
  /** 실제 연결로 설정된 제공자 가운데 마지막 호출이 실패한 것들의 이름.
   *  비어 있으면 대시보드에 경고 카드를 띄우지 않습니다. */
  failing_providers: string[];
  /** 서버 디스크의 채팅 첨부 파일과, 올리기를 멈추는 한도(chat-plus-files). */
  attachment_bytes?: number;
  attachment_limit_bytes?: number;
  /** admin-consolidation v3 (1): 처리할 일과 자동 알림. */
  open_reports?: number;
  wallet_alerts?: WalletAlert[];
  anthropic_month?: { month: string; used_usd: number; budget_usd: number | null; used_pct: number | null } | null;
  thumbnail_server?: "off" | "ok" | "down";
  week_top?: { places: { label: string; krw: number; pct: number }[]; app_name: string | null; app_krw: number };
}

/** 지원금의 80% 이상을 쓴 회원 (자동 알림). */
export interface WalletAlert {
  user_id: number;
  username: string;
  display_name: string;
  used_pct: number;
  remaining_krw: number;
}

/** 위쪽 찾기(⌘K): 회원과 앱을 이름으로. */
export interface AdminSearchResult {
  members: { id: number; username: string; display_name: string }[];
  apps: { id: number; name: string; owner_username: string }[];
}

export function searchAdmin(q: string): Promise<AdminSearchResult> {
  return request<AdminSearchResult>(`/admin/search?q=${encodeURIComponent(q)}`);
}

export interface MemberQuarterHistory {
  quarter_id: number;
  quarter_code: string;
  quarter_display_name: string;
  quarter_status: QuarterStatus;
  membership_status: MembershipStatus | null;
  application: QuarterApplication | null;
  allocation: QuarterAllocation | null;
}

export interface MemberDetail {
  user_id: number;
  username: string;
  display_name: string;
  email: string;
  role: "admin" | "member";
  account_status: AccountStatus;
  created_at: string;
  quarters: MemberQuarterHistory[];
  personal: {
    balance_krw: number;
    consumed_krw: number;
    remaining_krw: number;
    overage_enabled: boolean;
  } | null;
  top_ups: TopUp[];
  audit: AuditEntry[];
  /** 가장 최근의 탈퇴. 복구된 것도 포함합니다. 없으면 null. */
  withdrawal: Withdrawal | null;
}

export function getAdminDashboard(quarterId?: number | null): Promise<AdminDashboard> {
  const query = quarterId ? `?quarter_id=${quarterId}` : "";
  return request<AdminDashboard>(`/admin/dashboard${query}`);
}

export function getMemberDetail(userId: number): Promise<MemberDetail> {
  return request<MemberDetail>(`/admin/members/${userId}`);
}

/* ------------------------------------------------------------------ */
/* 공통 표기                                                           */
/* ------------------------------------------------------------------ */

/**
 * 계정 상태 — 로그인할 수 있는가.
 *
 * 참여 상태(`MEMBERSHIP_LABEL`)와 뜻이 다르므로 문구도 따로 둡니다.
 * "탈퇴 회원"이지 "삭제된 회원"이 아닙니다: 게시한 작품에 이름이 계속
 * 남아야 하기 때문입니다.
 */
export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  active: "사용 가능",
  inactive: "비활동",
  former: "탈퇴 회원",
};

export const ACCOUNT_STATUS_BADGE: Record<AccountStatus, string> = {
  active: "badge-ok",
  inactive: "badge-warn",
  former: "badge-muted",
};

export const ROLE_LABEL: Record<"admin" | "member", string> = {
  admin: "관리자",
  member: "회원",
};

export const APPLICATION_STATUS_BADGE: Record<ApplicationStatus, string> = {
  draft: "badge-muted",
  submitted: "badge-warn",
  approved: "badge-ok",
  rejected: "badge-error",
  cancelled: "badge-muted",
};

export const TOP_UP_STATUS_LABEL: Record<TopUp["status"], string> = {
  requested: "확인 대기",
  confirmed: "입금 확인",
  rejected: "거절",
  cancelled: "취소",
};

export const TOP_UP_STATUS_BADGE: Record<TopUp["status"], string> = {
  requested: "badge-warn",
  confirmed: "badge-ok",
  rejected: "badge-error",
  cancelled: "badge-muted",
};

/** 2026-10-01T05:12:33Z → 2026.10.01 14:12 (현지 시각) */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso.slice(0, 16).replace("T", " ");
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/* ------------------------------------------------------------------ */
/* 구역별 숫자                                                          */
/* ------------------------------------------------------------------ */
/* 전부 백엔드의 묶음 질의에서 옵니다. 목록 전체를 받아 브라우저에서 세면
 * 지금은 맞지만, 회원이 수백 명이 되는 순간 조용히 느려집니다. */

export interface ApplicationStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  requested_total_krw: number;
}

export interface MemberStats {
  total: number;
  active: number;
  inactive: number;
  not_applied: number;
  former: number;
  admins: number;
}

export interface QuarterStats {
  quarter_id: number;
  applicants: number;
  pending: number;
  participants: number;
  users_with_usage: number;
  /** 참여 회원이 0이면 null — 0%가 아니라 "셀 수 없음"이고, 화면은 "–"로 적습니다. */
  usage_rate: number | null;
}

export interface QuarterWithStats extends Quarter {
  stats: QuarterStats;
}

export function getApplicationStats(quarterId?: number | null): Promise<ApplicationStats> {
  const query = quarterId ? `?quarter_id=${quarterId}` : "";
  return request<ApplicationStats>(`/admin/stats/applications${query}`);
}

export function getMemberStats(quarterId?: number | null): Promise<MemberStats> {
  const query = quarterId ? `?quarter_id=${quarterId}` : "";
  return request<MemberStats>(`/admin/stats/members${query}`);
}

export function listQuartersWithStats(): Promise<QuarterWithStats[]> {
  return request<QuarterWithStats[]>("/admin/quarters-with-stats");
}

export function createQuarter(input: {
  code: string;
  display_name: string;
  starts_at: string;
  ends_at: string;
  application_opens_at: string | null;
  application_closes_at: string | null;
  subsidy_limit_krw: number | null;
}): Promise<Quarter> {
  return request<Quarter>("/admin/quarters", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ------------------------------------------------------------------ */
/* 외부 서비스                                                          */
/* ------------------------------------------------------------------ */

export interface ProviderStatus {
  key: string;
  name: string;
  purpose: string;
  /** 어떤 환경 변수가 이 서비스를 고르는지 — 바꿀 곳을 알려 줍니다. */
  setting: string;
  mode: string;
  is_mock: boolean;
  /** 키가 설정돼 있는지만. 키 자체는 어떤 응답에도 들어 있지 않습니다. */
  has_key: boolean;
  last_success_at: string | null;
  last_success_label: string;
  last_error_at: string | null;
  last_error_message: string;
  /** 제공자가 알려 줄 때만 채워집니다. 없으면 보여 주지 않습니다. */
  balance_label: string | null;
}

export interface ProviderCheckResult {
  key: string;
  ok: boolean;
  message: string;
  checked_at: string;
}

export function listProviders(): Promise<ProviderStatus[]> {
  return request<ProviderStatus[]>("/admin/providers");
}

/** 눌렀을 때만 돕니다. 자동으로 부르지 않습니다 — 돈이 드는 호출일 수 있습니다. */
export function checkProvider(key: string): Promise<ProviderCheckResult> {
  return request<ProviderCheckResult>(`/admin/providers/${key}/check`, { method: "POST" });
}

/** 2026.10.01 또는 아직 없으면 "기록 없음". */
export function formatWhenOrNever(iso: string | null): string {
  return iso === null ? "기록 없음" : formatWhen(iso);
}

/* ------------------------------------------------------------------ */
/* AI 모델 목록 (Admin › AI Models)                                     */
/* ------------------------------------------------------------------ */

/** 누가 고를 수 있는가. */
export type ChatModelVisibility = "members" | "admin" | "disabled";

export const VISIBILITY_LABEL: Record<ChatModelVisibility, string> = {
  members: "회원에게 공개",
  admin: "관리자만",
  disabled: "사용 안 함",
};

/** 목록의 모델 한 개. 요금은 달러, 100만 토큰당이고 소수는 문자열로 옵니다. */
export interface AdminChatModel {
  id: number;
  provider: string;
  model_id: string;
  label: string;
  description: string;
  input_usd_per_mtok: string;
  output_usd_per_mtok: string;
  /** 프롬프트 캐시 읽기 요금. null이면 입력 요금의 1/10입니다. */
  cache_read_usd_per_mtok: string | null;
  visibility: ChatModelVisibility;
  is_default: boolean;
  sort_order: number;
  updated_at: string;
  /** 회원이 고르는 창에 보이는 "답장 1회 약 N원"과 같은 값. */
  estimated_reply_krw: number | null;
  estimate_basis?: "recent" | "formula";
  estimate_samples?: number;
  /** "Anthropic (Claude)". */
  provider_label?: string;
  /** false: 연결 준비 중 — 공개도 기본도 될 수 없습니다(백엔드가 막습니다). */
  provider_ready?: boolean;
  /** 서버 도구(chat-plus-tools): 이 모델에 열어 둔 것과 검색 1회 요금($). */
  tools_web_search: boolean;
  tools_web_fetch: boolean;
  tools_code_execution: boolean;
  web_search_usd_per_call: string;
}

/** 제공자 한 곳. 화면에 보이는 순서대로 옵니다 — Anthropic이 먼저. */
export interface ChatProvider {
  id: string;
  label: string;
  /** 연결(어댑터)이 있는지. false면 "연결 준비 중". */
  ready: boolean;
}

export function listChatProviders(): Promise<ChatProvider[]> {
  return request<ChatProvider[]>("/admin/chat-models/providers");
}

export interface ChatModelChanges {
  label?: string;
  description?: string;
  input_usd_per_mtok?: string;
  output_usd_per_mtok?: string;
  cache_read_usd_per_mtok?: string;
  visibility?: ChatModelVisibility;
  sort_order?: number;
  is_default?: true;
  tools_web_search?: boolean;
  tools_web_fetch?: boolean;
  tools_code_execution?: boolean;
  web_search_usd_per_call?: string;
}

export interface NewChatModel {
  provider: string;
  model_id: string;
  label: string;
  description: string;
  input_usd_per_mtok: string;
  output_usd_per_mtok: string;
}

/** Admin › AI Models › 비용 보정 — 모델별 어림값과 실제 답장. */
export interface ModelCalibration {
  model_id: string;
  label: string;
  samples: number;
  calibrated: boolean;
  input_ratio: number | null;
  input_factor: number;
  avg_prompt_tokens: number | null;
  avg_estimated_tokens: number | null;
  avg_output_tokens: number | null;
  avg_reply_krw: number | null;
  median_reply_krw: number | null;
  formula_reply_krw: number | null;
  cache_hit_rate: number | null;
}

/** 캐시 절약 (PART F): 모델·일(KST)별 캐시 활동. */
export interface ModelCacheDay {
  model_id: string;
  label: string;
  day: string;
  replies: number;
  cache_hit_replies: number;
  read_tokens: number;
  /** 오늘 카탈로그 요금 기준의 어림 — 화면에도 그렇게 적습니다. */
  saved_krw: number;
}

export function getChatCacheStats(): Promise<ModelCacheDay[]> {
  return request<ModelCacheDay[]>("/admin/chat-models/cache-stats");
}

export function getChatCalibration(): Promise<ModelCalibration[]> {
  return request<ModelCalibration[]>("/admin/chat-models/calibration");
}

export function listChatModels(): Promise<AdminChatModel[]> {
  return request<AdminChatModel[]>("/admin/chat-models");
}

export function updateChatModel(id: number, changes: ChatModelChanges): Promise<AdminChatModel> {
  return request<AdminChatModel>(`/admin/chat-models/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/** 새 모델은 "사용 안 함"으로 들어갑니다. 열어 주는 것은 따로 합니다. */
export function createChatModel(input: NewChatModel): Promise<AdminChatModel> {
  return request<AdminChatModel>("/admin/chat-models", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ------------------------------------------------------------------ */
/* 환율과 Claude 호출 설정 (Admin › System)                             */
/* ------------------------------------------------------------------ */

export interface ExchangeRate {
  krw_per_usd: string;
  set_at: string;
  set_by_username: string;
  /** owner-polish-3 (b): "seed" | "admin" | "mock" | "frankfurter". */
  source?: string;
  /** 자동으로 받아 온 줄이면 그 환율의 기준 날짜. */
  fetched_for?: string | null;
}

/** owner-polish-3 (b): 환율 자동 반영의 상태 — 스위치, 마지막 확인, 보류 경고. */
export interface FxStatus {
  provider: string;
  is_mock: boolean;
  /** false = 관리자가 환율을 고정함. 아무것도 받아 오지 않아요. */
  auto_enabled: boolean;
  checked_at: string | null;
  fetched_rate: string | null;
  fetched_for: string | null;
  /** "applied" | "unchanged" | "blocked" | "failed" | "". */
  outcome: string;
  outcome_label: string;
  /** 보류 중인 변동이나 실패의 이유 — 경고로 보여요. */
  note: string;
  max_jump_pct: string;
}

/** `GET /api/admin/claude-pricing`. API 키는 들어 있지 않습니다. */
export interface ClaudeSettings {
  is_mock: boolean;
  /** 새 대화와 프롬프트 도움이 쓰는 기본 모델. 목록이 비면 빈 문자열. */
  default_model_label: string;
  default_model_id: string;
  /** ANTHROPIC_MODEL — 모델 목록이 비었을 때만 씁니다. */
  fallback_model: string;
  thinking: string;
  effort: string;
  max_output_tokens: number;
  context_tokens: number;
  rate_limit_per_minute: number;
  /** CHAT_PROMPT_CACHE. */
  prompt_cache: boolean;
  /** "5m" / "1h", 캐시를 끄면 null. */
  cache_ttl: string | null;
  exchange_rate: ExchangeRate | null;
  rate_history: ExchangeRate[];
  /** owner-polish-3 (b): 자동 반영의 상태. */
  fx: FxStatus;
  /** token-guard의 세 한도. 0은 그 한도를 끈 것입니다. */
  chat_limits: ChatLimits;
}

/** 답장 1회 비용 한도, 긴 대화 경고 기준, 하루 한도 (token-guard). */
export interface ChatLimits {
  reply_cap_krw: number;
  long_history_tokens: number;
  daily_cap_krw: number;
  /** 서버 프로세스마다, AI 호출을 한 번에 몇 개까지 (PART F). */
  provider_concurrency: number;
  /** 웹 페이지 읽기: 한 답장의 횟수와 페이지당 토큰 (tool-cap-defaults). */
  web_fetch_max_uses: number;
  /** 웹 검색: 한 답장에 최대 몇 회 (fix-real-web-search). */
  web_search_max_uses?: number;
  web_fetch_max_content_tokens: number;
  /** 앱 AI: 방문자 1명이 하루(KST)에 회원 앱들에서 쓸 수 있는 금액. 0이면 끔 (app-platform P2). */
  app_ai_daily_cap_krw?: number;
  /** 생각 깊이마다의 최대 출력과 1회 한도(quality-tuning Q1). */
  depth_levels?: DepthTable;
  /** 답장마다 함께 보내는 대화 기록(토큰)과 응답 대기 시간(초). */
  context_tokens?: number;
  timeout_seconds?: number;
  set_at: string | null;
  set_by_username: string;
}

export interface ChatLimitsWrite {
  reply_cap_krw: number;
  long_history_tokens: number;
  daily_cap_krw: number;
  provider_concurrency: number;
  web_fetch_max_uses: number;
  /** 웹 검색: 한 답장에 최대 몇 회 (fix-real-web-search). */
  web_search_max_uses?: number;
  web_fetch_max_content_tokens: number;
  app_ai_daily_cap_krw?: number;
  depth_levels?: DepthTable;
  context_tokens?: number;
  timeout_seconds?: number;
}

/** 채팅·빌더 × 낮음·보통·높음·최고 → 최대 출력 토큰, 1회 한도(원), 전체 한도(원 —
 *  feat-auto-continue: 서버가 이어 쓰는 답장 전체의 상한; 0이면 이어 쓰지 않음). */
export type DepthSurface = "chat" | "builder";
export type DepthTable = Record<
  DepthSurface,
  Record<"low" | "medium" | "high" | "max", { max_tokens: number; cap_krw: number; total_cap_krw?: number }>
>;

export function getClaudeSettings(): Promise<ClaudeSettings> {
  return request<ClaudeSettings>("/admin/claude-pricing");
}

export function setExchangeRate(krwPerUsd: string): Promise<ClaudeSettings> {
  return request<ClaudeSettings>("/admin/claude-pricing/exchange-rate", {
    method: "POST",
    body: JSON.stringify({ krw_per_usd: krwPerUsd }),
  });
}

/** owner-polish-3 (b): 자동 반영 켜기(true) / 지금 환율 고정(false). */
export function setExchangeRateAuto(on: boolean): Promise<ClaudeSettings> {
  return request<ClaudeSettings>("/admin/claude-pricing/exchange-rate/auto", {
    method: "POST",
    body: JSON.stringify({ on }),
  });
}

/** owner-polish-3 (b): 지금 새로 고침 — 하루 한 번 도는 것과 같은 규칙으로. */
export function refreshExchangeRate(): Promise<ClaudeSettings> {
  return request<ClaudeSettings>("/admin/claude-pricing/exchange-rate/refresh", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function setChatLimits(limits: ChatLimitsWrite): Promise<ClaudeSettings> {
  return request<ClaudeSettings>("/admin/claude-pricing/chat-limits", {
    method: "POST",
    body: JSON.stringify(limits),
  });
}

// ------------------------------------------------------------------ 기능 열기 (owner-polish 6)

/** 관리자가 켜고 끄는 기능 스위치. 첫 번째는 회원에게 Video Generator 열기. */
export interface FeatureSwitch {
  key: string;
  label: string;
  open: boolean;
  note: string;
  set_by_username: string;
  set_at: string | null;
}

export function listFeatures(): Promise<FeatureSwitch[]> {
  return request<FeatureSwitch[]>("/admin/features");
}

export function setFeature(key: string, open: boolean, note: string): Promise<FeatureSwitch> {
  return request<FeatureSwitch>(`/admin/features/${encodeURIComponent(key)}`, {
    method: "POST",
    body: JSON.stringify({ open, note }),
  });
}
