/**
 * 분기(Quarter) 참여와 예산 API 클라이언트.
 *
 * Ctrl AI는 분기 단위로 운영됩니다. 크레딧은 자동으로 주어지지 않습니다.
 * 관리자가 신청을 열면 회원이 Build/Video 비율을 정해 신청하고, 관리자가
 * 승인해야 사용할 수 있는 예산이 생깁니다.
 *
 * 금액의 기준은 원(KRW)입니다. 토큰이나 생성 횟수로 환산하지 않습니다.
 * 제공자 가격이 바뀌어도 이미 승인된 예산이 흔들리면 안 되기 때문입니다.
 */

import { request } from "./http";

export type QuarterStatus = "draft" | "application_open" | "active" | "closed";

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled";

export type TopUpStatus = "requested" | "confirmed" | "rejected" | "cancelled";

export const QUARTER_STATUS_LABEL: Record<QuarterStatus, string> = {
  draft: "준비 중",
  application_open: "신청 접수 중",
  active: "진행 중",
  closed: "종료",
};

export const QUARTER_STATUS_BADGE: Record<QuarterStatus, string> = {
  draft: "badge-muted",
  application_open: "badge-accent",
  active: "badge-ok",
  closed: "badge-muted",
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: "작성 중",
  submitted: "승인 대기",
  approved: "승인됨",
  rejected: "거절됨",
  cancelled: "취소됨",
};

export interface Quarter {
  id: number;
  code: string;
  display_name: string;
  starts_at: string;
  ends_at: string;
  application_opens_at: string | null;
  application_closes_at: string | null;
  status: QuarterStatus;
  /** 이 분기에 회원 한 명이 받을 수 있는 공동체 지원 한도(원). */
  subsidy_limit_krw: number;
}

export interface QuarterApplication {
  id: number;
  user_id: number;
  quarter_id: number;
  build_percentage: number;
  video_percentage: number;
  requested_total_budget_krw: number;
  requested_build_budget_krw: number;
  requested_video_budget_krw: number;
  status: ApplicationStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  admin_note: string;
}

export interface ApplicationWithMember extends QuarterApplication {
  username: string;
  display_name: string;
}

export interface QuarterAllocation {
  id: number;
  quarter_id: number;
  community_total_budget_krw: number;
  build_budget_krw: number;
  video_budget_krw: number;
  build_percentage: number;
  video_percentage: number;
  build_consumed_krw: number;
  video_consumed_krw: number;
  build_remaining_krw: number;
  video_remaining_krw: number;
  approved_at: string | null;
}

export interface PersonalBalance {
  balance_krw: number;
  consumed_krw: number;
  remaining_krw: number;
  /** 회원이 직접 켜야만 개인 잔액이 쓰입니다. */
  overage_enabled: boolean;
}

export interface TopUp {
  id: number;
  user_id: number;
  amount_krw: number;
  status: TopUpStatus;
  requested_at: string | null;
  confirmed_at: string | null;
  payment_reference: string | null;
}

/** Profile이 필요로 하는 모든 것. */
export interface MyQuarterStatus {
  quarter: Quarter | null;
  application: QuarterApplication | null;
  allocation: QuarterAllocation | null;
  personal: PersonalBalance | null;
  /** 신청 가능 / 승인 대기 / 활동 회원 / 미참여 / 신청 거절 */
  participation: string;
  days_remaining: number | null;
}

/* ------------------------------------------------------------------ */
/* 회원                                                                 */
/* ------------------------------------------------------------------ */

export function getMyQuarter(): Promise<MyQuarterStatus> {
  return request<MyQuarterStatus>("/quarters/me");
}

export function applyForQuarter(
  quarterId: number,
  split: { build_percentage: number; video_percentage: number },
): Promise<QuarterApplication> {
  return request<QuarterApplication>(`/quarters/${quarterId}/apply`, {
    method: "POST",
    body: JSON.stringify(split),
  });
}

export function cancelApplication(applicationId: number): Promise<QuarterApplication> {
  return request<QuarterApplication>(`/quarters/applications/${applicationId}/cancel`, {
    method: "POST",
  });
}

export function setOverageEnabled(enabled: boolean): Promise<PersonalBalance> {
  return request<PersonalBalance>("/quarters/me/wallet", {
    method: "PATCH",
    body: JSON.stringify({ overage_enabled: enabled }),
  });
}

export function requestTopUp(amountKrw: number): Promise<TopUp> {
  return request<TopUp>("/quarters/me/top-ups", {
    method: "POST",
    body: JSON.stringify({ amount_krw: amountKrw }),
  });
}

export function listMyTopUps(): Promise<TopUp[]> {
  return request<TopUp[]>("/quarters/me/top-ups");
}

/* ------------------------------------------------------------------ */
/* 관리자                                                               */
/* ------------------------------------------------------------------ */

export function listQuarters(): Promise<Quarter[]> {
  return request<Quarter[]>("/admin/quarters");
}

export function updateQuarter(
  id: number,
  changes: Partial<Pick<Quarter, "status" | "subsidy_limit_krw" | "display_name">>,
): Promise<Quarter> {
  return request<Quarter>(`/admin/quarters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function listQuarterApplications(quarterId: number): Promise<ApplicationWithMember[]> {
  return request<ApplicationWithMember[]>(`/admin/quarters/${quarterId}/applications`);
}

export function reviewApplication(
  applicationId: number,
  approve: boolean,
  adminNote = "",
): Promise<QuarterApplication> {
  return request<QuarterApplication>(`/admin/applications/${applicationId}/review`, {
    method: "POST",
    body: JSON.stringify({ approve, admin_note: adminNote }),
  });
}

export function listAllTopUps(): Promise<TopUp[]> {
  return request<TopUp[]>("/admin/top-ups");
}

export function confirmTopUp(
  topUpId: number,
  confirm: boolean,
  paymentReference?: string,
): Promise<TopUp> {
  return request<TopUp>(`/admin/top-ups/${topUpId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ confirm, payment_reference: paymentReference ?? null }),
  });
}

/* ------------------------------------------------------------------ */
/* 계산과 표기                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build/Video 비율을 금액으로 바꿉니다.
 *
 * 백엔드의 services/budget.py와 같은 규칙입니다. Build는 내림하고 Video가
 * 나머지를 가져가므로 두 금액의 합은 항상 한도와 정확히 같습니다.
 * 화면에서 미리 보여 주기 위한 계산이며, 실제 승인 금액은 백엔드가 정합니다.
 */
export function splitBudget(
  buildPercentage: number,
  totalKrw: number,
): { buildKrw: number; videoKrw: number } {
  const build = Math.floor((totalKrw * buildPercentage) / 100);
  return { buildKrw: build, videoKrw: totalKrw - build };
}

/** 100000 -> "100,000원" */
export function formatKrw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

/** "2026-01-01" -> "2026.01.01" */
export function formatDate(iso: string | null): string {
  return iso ? iso.replaceAll("-", ".") : "";
}
