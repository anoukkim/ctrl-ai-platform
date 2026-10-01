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
  video_models_total: number;
  video_models_member_visible: number;
  recent_audit: AuditEntry[];
  /** 개발 환경에서만 true. 개발 도구를 보일지 정합니다. */
  is_development: boolean;
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
