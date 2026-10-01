/**
 * 분기(Quarter) 참여와 예산 API 클라이언트.
 *
 * CTRL+AI는 분기 단위로 운영됩니다. 크레딧은 자동으로 주어지지 않습니다.
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
/** 이번 분기 참여 상태. 백엔드의 MembershipStatus와 짝을 이룹니다. */
export type MembershipStatus = "active" | "inactive" | "former";

/** 화면에 보여 줄 한국어 표기. */
export const MEMBERSHIP_LABEL: Record<MembershipStatus, string> = {
  active: "활동 회원",
  inactive: "비활동 회원",
  former: "탈퇴 회원",
};

export const MEMBERSHIP_BADGE: Record<MembershipStatus, string> = {
  active: "badge-ok",
  inactive: "badge-warn",
  former: "badge-muted",
};

/**
 * 참여하지 않는 회원에게 보여 줄 설명. 백엔드 403 문구와 뜻을 맞춥니다.
 *
 * 한 문장으로 모아 둔 이유: Chat, Project Builder, Video Generator,
 * 두 목록 화면, 그리고 잠긴 버튼의 안내까지 모두 같은 말을 해야 합니다.
 *
 * 원래 요청서의 문장은 "내 작업물 보기와 다운로드는 가능합니다"였습니다.
 * 다운로드는 아직 없으므로(docs/BACKLOG.md의 project-video-management)
 * 지금 없는 기능을 약속하지 않도록 그 부분만 뺐습니다. 다운로드가 생기면
 * 이 한 줄만 고치면 됩니다.
 */
export const NOT_PARTICIPATING_HINT =
  "이번 분기에 참여하지 않아 AI 기능을 사용할 수 없습니다. 지금까지 만든 작업물은 그대로 볼 수 있습니다.";

export interface MyQuarterStatus {
  quarter: Quarter | null;
  application: QuarterApplication | null;
  allocation: QuarterAllocation | null;
  personal: PersonalBalance | null;
  /** 신청 가능 / 승인 대기 / 활동 회원 / 미참여 / 신청 거절 */
  participation: string;
  days_remaining: number | null;
  /** null이면 이번 분기에 참여 기록이 없다는 뜻입니다. */
  membership_status: MembershipStatus | null;
  /** 새로 만들 수 있는지. 실제 차단은 백엔드가 합니다. */
  may_create: boolean;
}

export interface MemberWithMembership {
  user_id: number;
  username: string;
  display_name: string;
  role: "admin" | "member";
  account_status: MembershipStatus;
  membership_status: MembershipStatus | null;
}

export function listQuarterMembers(quarterId: number): Promise<MemberWithMembership[]> {
  return request<MemberWithMembership[]>(`/admin/quarters/${quarterId}/members`);
}

export function setQuarterMembership(
  quarterId: number,
  userId: number,
  status: MembershipStatus,
): Promise<MemberWithMembership> {
  return request<MemberWithMembership>(`/admin/quarters/${quarterId}/members/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
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

/* ------------------------------------------------------------------ */
/* 사용량 (Phase 1c)                                                    */
/* ------------------------------------------------------------------ */

export type BudgetCategory = "build" | "video";
export type FundingSource = "community_build" | "community_video" | "personal";

/** 차감 출처 표기. 공동체 지원과 개인 잔액은 끝까지 구분해서 보여 줍니다. */
export const FUNDING_LABEL: Record<FundingSource, string> = {
  community_build: "공동체 지원",
  community_video: "공동체 지원",
  personal: "개인 잔액",
};

/** 제공자 id를 사람이 읽는 이름으로. 카드와 표가 같은 이름을 쓰도록. */
export const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  anthropic: "Claude",
  higgsfield: "Higgsfield",
};

export function providerName(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

export interface UsageEvent {
  id: number;
  created_at: string;
  category: BudgetCategory;
  funding_source: FundingSource;
  provider: string;
  model_id: string | null;
  charged_krw: number;
  /** 어디에서 썼는지, 회원이 알아보는 이름으로. */
  label: string;
}

export interface CategoryUsage {
  category: BudgetCategory;
  /** 실제로 일을 하는 서비스 — Claude / Higgsfield. */
  provider: string;
  budget_krw: number;
  consumed_krw: number;
  remaining_krw: number;
}

export interface PersonalUsage {
  balance_krw: number;
  consumed_krw: number;
  remaining_krw: number;
  overage_enabled: boolean;
}

export interface MyUsage {
  quarter_code: string | null;
  quarter_name: string | null;
  days_remaining: number | null;
  membership_status: MembershipStatus | null;
  categories: CategoryUsage[];
  total_budget_krw: number;
  personal: PersonalUsage | null;
  events: UsageEvent[];
}

export function getMyUsage(): Promise<MyUsage> {
  return request<MyUsage>("/usage/me");
}

/* ------------------------------------------------------------------ */
/* 관리자 — 역할, 지원금 조정, 감사 로그, 시뮬레이션                      */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  id: number;
  created_at: string;
  actor_username: string;
  action: string;
  action_label: string;
  target_type: string;
  target_label: string;
  summary: string;
}

export function listAuditLog(): Promise<AuditEntry[]> {
  return request<AuditEntry[]>("/admin/audit");
}

export function setMemberRole(
  userId: number,
  role: "admin" | "member",
): Promise<MemberWithMembership> {
  return request<MemberWithMembership>(`/admin/members/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

export function adjustAllocation(
  quarterId: number,
  userId: number,
  buildKrw: number,
  videoKrw: number,
  note = "",
): Promise<QuarterAllocation> {
  return request<QuarterAllocation>(`/admin/quarters/${quarterId}/allocations/${userId}`, {
    method: "PUT",
    body: JSON.stringify({
      build_budget_krw: buildKrw,
      video_budget_krw: videoKrw,
      note,
    }),
  });
}

/** 개발 환경에서만 동작합니다. 배포 환경에서는 404를 돌려줍니다. */
export function simulateUsage(input: {
  user_id?: number;
  category: BudgetCategory;
  amount_krw: number;
  provider?: string;
}): Promise<UsageEvent> {
  return request<UsageEvent>("/admin/simulate-usage", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
