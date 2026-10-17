/**
 * 분기(Quarter) 참여와 예산 API 클라이언트.
 *
 * CTRL+AI는 분기 단위로 운영됩니다. 크레딧은 자동으로 주어지지 않습니다.
 * 관리자가 신청을 열면 회원이 "이번 분기 참여"를 누르고, 관리자가 승인해야
 * 그 분기의 동아리 지원 지갑이 생깁니다. 지갑은 하나뿐이고 채팅, 영상 등
 * 모든 유료 기능이 같은 잔액에서 씁니다(single-wallet).
 *
 * 금액의 기준은 원(KRW)입니다. 토큰이나 생성 횟수로 환산하지 않습니다.
 * 제공자 가격이 바뀌어도 이미 승인된 예산이 흔들리면 안 되기 때문입니다.
 */

import type { MoneySplit } from "@/lib/money";
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
  closed: "마감",
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
  /** 이 분기에 참여하는 회원 한 명이 받는 동아리 지원(원). 기본 80,000원. */
  subsidy_limit_krw: number;
}

export interface QuarterApplication {
  id: number;
  user_id: number;
  quarter_id: number;
  /** 신청할 때의 분기 지원금. */
  requested_budget_krw: number;
  status: ApplicationStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  admin_note: string;
}

export interface ApplicationWithMember extends QuarterApplication {
  username: string;
  display_name: string;
  /** 누가 심사했는지. 아직 처리되지 않았으면 빈 문자열입니다. */
  reviewed_by_username: string;
  reviewed_by_display_name: string;
}

/** 한 회원의 이번 분기 동아리 지원 지갑. */
export interface QuarterAllocation {
  id: number;
  quarter_id: number;
  budget_krw: number;
  consumed_krw: number;
  remaining_krw: number;
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
  /** 이번 분기 신청 상태. null이면 신청한 적이 없음 — 참여 기록도 없으면
   *  미신청 (owner-polish 8). */
  application_status: ApplicationStatus | null;
  /** admin-consolidation v3 (2): 심사를 기다리는 신청(줄에서 승인/거절)과 지갑(사용률). */
  application_id?: number | null;
  requested_budget_krw?: number | null;
  budget_krw?: number | null;
  consumed_krw?: number | null;
}

/** 지갑을 쓴 비율(0–100), 지갑이 없으면 null. */
export function usedPct(member: MemberWithMembership): number | null {
  if (!member.budget_krw) return null;
  return Math.min(100, Math.round(((member.consumed_krw ?? 0) * 100) / member.budget_krw));
}

/** 미신청: 이번 분기에 신청도, 참여 기록도 없는 사람 — 카드와 거르기가 같은 뜻.
 *  탈퇴 회원은 백엔드의 카드 숫자처럼 빼고 셉니다 (아직 신청할 사람이 아니므로). */
export function isNotApplied(member: MemberWithMembership): boolean {
  return (
    member.account_status !== "former" &&
    member.membership_status === null &&
    member.application_status === null
  );
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

/** 이번 분기 참여 — 나눌 것이 없습니다. 금액은 분기가 정합니다. */
export function applyForQuarter(quarterId: number): Promise<QuarterApplication> {
  return request<QuarterApplication>(`/quarters/${quarterId}/apply`, { method: "POST" });
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
  changes: Partial<
    Pick<Quarter, "status" | "subsidy_limit_krw" | "display_name" | "application_closes_at">
  >,
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

export type FundingSource = "community" | "personal";

/** 차감 출처 표기. 동아리 지원과 개인 잔액은 끝까지 구분해서 보여 줍니다. */
export const FUNDING_LABEL: Record<FundingSource, string> = {
  community: "동아리 지원",
  personal: "개인 잔액",
};

/** 지갑 사용 내역의 묶음 — 정보일 뿐, 따로 정해진 한도는 없습니다. */
export type SpendingGroup = "chat" | "build" | "video" | "other";

export const SPENDING_LABEL: Record<SpendingGroup, string> = {
  chat: "채팅",
  build: "빌더",
  video: "영상",
  other: "기타",
};

/**
 * 어느 돈이 먼저 쓰이는지. Usage와 Profile이 같은 문장을 씁니다.
 * 규칙은 백엔드의 usage.charge()가 정하고, 이 문장은 그 규칙을 옮긴 것입니다.
 */
export const SPENDING_ORDER_NOTE =
  "동아리 지원금을 먼저 씁니다. 다 쓰면, 개인 사용을 켠 경우에만 개인 잔액에서 씁니다. 한 번의 사용이 두 곳에 나뉘어 결제되지는 않습니다.";

/** 제공자 id를 사람이 읽는 이름으로. 카드와 표가 같은 이름을 쓰도록. */
export const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  anthropic: "Claude",
  higgsfield: "Higgsfield",
};

export function providerName(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

/**
 * 회원이 읽는 이름 — 회사 이름 대신 무엇을 하는 곳인지(ui-friendly-motion).
 * Admin은 제공자 이름을 그대로 봅니다(`providerName`).
 */
export const PROVIDER_FRIENDLY: Record<string, string> = {
  claude: "Claude · 대화와 글",
  anthropic: "Claude · 대화와 글",
  higgsfield: "Higgsfield · 영상",
};

export function providerFriendly(id: string): string {
  return PROVIDER_FRIENDLY[id] ?? providerName(id);
}

export interface UsageEvent {
  id: number;
  created_at: string;
  funding_source: FundingSource;
  provider: string;
  feature: string | null;
  model_id: string | null;
  charged_krw: number;
  group: SpendingGroup;
  /** 어디에서 썼는지, 회원이 알아보는 이름으로. */
  label: string;
  /** 같은 차감을 항목별로(cost-clarity). */
  split?: MoneySplit | null;
}

export interface WalletUsage {
  budget_krw: number;
  consumed_krw: number;
  remaining_krw: number;
}

export interface SpendingLine {
  group: SpendingGroup;
  label: string;
  consumed_krw: number;
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
  /** 이번 분기에 승인된 지갑이 없으면 null. */
  wallet: WalletUsage | null;
  /** 채팅 / 빌더 / 영상 / 기타 — 합하면 wallet.consumed_krw. */
  breakdown: SpendingLine[];
  personal: PersonalUsage | null;
  events: UsageEvent[];
  /** 대화별·날짜별 합계와 이번 분기 캐시 절약(cost-clarity). 분기가 없으면 null. */
  money?: MemberMoney | null;
}

export interface ConversationMoney {
  /** 지운 대화면 null — 돈의 기록은 남습니다. */
  conversation_id: number | null;
  title: string;
  last_at: string;
  split: MoneySplit;
}

export interface DayMoney {
  /** KST 날짜, YYYY-MM-DD. */
  day: string;
  split: MoneySplit;
}

export interface MemberMoney {
  quarter: MoneySplit;
  by_conversation: ConversationMoney[];
  by_day: DayMoney[];
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

/** 지갑 조정 한 줄(cost-clarity) — 덮어쓰지 않고 행으로 남습니다. */
export interface WalletAdjustment {
  id: number;
  quarter_id: number;
  quarter_name: string;
  amount_krw: number;
  /** "adjust"(관리자 조정) | "carry_over"(지난 분기에서 이월). */
  kind: string;
  reason: string;
  budget_before_krw: number;
  budget_after_krw: number;
  created_by_username: string;
  created_at: string;
}

/** 한 회원의 지갑을 +/− 원만큼, 사유와 함께. */
export function adjustAllocation(
  quarterId: number,
  userId: number,
  amountKrw: number,
  reason: string,
): Promise<WalletAdjustment> {
  return request<WalletAdjustment>(
    `/admin/quarters/${quarterId}/allocations/${userId}/adjustments`,
    { method: "POST", body: JSON.stringify({ amount_krw: amountKrw, reason }) },
  );
}

export function getAdjustments(userId: number): Promise<WalletAdjustment[]> {
  return request<WalletAdjustment[]>(`/admin/members/${userId}/adjustments`);
}

/* ------------------------------------------------------------------ */
/* 관리자 — Budget: 지갑과 제공자별 사용액                               */
/* ------------------------------------------------------------------ */

export interface MemberWallet {
  user_id: number;
  username: string;
  display_name: string;
  account_status: MembershipStatus;
  membership_status: MembershipStatus | null;
  budget_krw: number;
  consumed_krw: number;
  remaining_krw: number;
}

export interface ProviderSpend {
  provider: string;
  label: string;
  events: number;
  charged_krw: number;
  /** 동아리 지원 지갑에서 나간 몫. */
  community_krw: number;
  /** 개인 잔액에서 나간 몫. */
  personal_krw: number;
  /** 통화별 제공자 금액(문자열, 소수 둘째 자리). */
  provider_cost: Record<string, string>;
  units: Record<string, number>;
  input_tokens: number;
  output_tokens: number;
  /** 프롬프트 캐시. input_tokens는 캐시를 거치지 않은 입력만입니다. */
  cache_write_tokens: number;
  cache_read_tokens: number;
  /** 입력 가운데 캐시에서 읽은 몫(0–1). */
  cache_hit_rate: number | null;
  share: number | null;
  share_of_wallets_krw: number | null;
}

export interface QuarterBudget {
  quarter: Quarter;
  member_budget_krw: number;
  wallets: MemberWallet[];
  total_budget_krw: number;
  total_consumed_krw: number;
  total_remaining_krw: number;
  providers: ProviderSpend[];
  total_charged_krw: number;
  /** 이번 달(KST) Anthropic에 쓴 달러 — provider_cost의 합 (PART F). */
  anthropic_month_usd: number;
  /** ANTHROPIC_MONTHLY_BUDGET_USD. null이면 막대를 그리지 않습니다. */
  anthropic_month_budget_usd: number | null;
  anthropic_month: string;
  /** Claude 사용을 모델 × 기능 × 생각 깊이로(quality-tuning Q1). 많이 쓴 순서. */
  model_depth?: ModelDepthSpend[];
}

export interface ModelDepthSpend {
  model_id: string;
  /** "chat", "build", "app_ai" … */
  feature: string;
  /** null — 깊이가 없는 모델(Haiku)이거나 생각 깊이 이전의 기록. */
  depth: string | null;
  events: number;
  charged_krw: number;
  output_tokens: number;
  average_krw: number;
}

export function getQuarterBudget(quarterId: number): Promise<QuarterBudget> {
  return request<QuarterBudget>(`/admin/quarters/${quarterId}/budget`);
}

/** "이번 분기 지원금 80,000원 중 52,300원 남음" — 사이드바와 Usage가 같은 문장을 씁니다. */
export function walletSentence(wallet: { budget_krw: number; remaining_krw: number }): string {
  return `이번 분기 지원금 ${formatKrw(wallet.budget_krw)} 중 ${formatKrw(wallet.remaining_krw)} 남음`;
}

/* ------------------------------------------------------------------ */
/* 예상 비용과 지갑 비교                                                 */
/* ------------------------------------------------------------------ */

export type WalletTone = "ok" | "personal" | "short";

export interface WalletComparison {
  tone: WalletTone;
  text: string;
}

/**
 * 버튼 옆의 예상 비용을 **하나뿐인 지갑**과 비교합니다.
 *
 * 규칙은 백엔드 usage.charge()와 같습니다: 지갑이 먼저, 모자라면 개인
 * 사용을 켠 경우에만 개인 잔액, 한 번의 사용을 두 곳에 나누지 않음.
 * 화면 안내일 뿐이고 실제 판단은 백엔드가 요청마다 합니다.
 */
export function compareToWallet(
  costKrw: number | null,
  wallet: { remaining_krw: number } | null,
  personal: { remaining_krw: number; overage_enabled: boolean } | null,
): WalletComparison | null {
  if (wallet === null) return null;
  const left = `남은 지원금 ${formatKrw(wallet.remaining_krw)}`;
  if (costKrw === null || costKrw <= wallet.remaining_krw) return { tone: "ok", text: left };
  if (personal?.overage_enabled && costKrw <= personal.remaining_krw) {
    return { tone: "personal", text: `${left} · 부족한 만큼 개인 잔액에서 결제됩니다` };
  }
  return { tone: "short", text: `지원금이 부족합니다 (${left})` };
}
