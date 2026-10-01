"use client";

/**
 * 상태 배지 — 모양 한 벌.
 *
 * Admin에는 뜻이 다른 상태가 다섯 가지 있습니다(계정, 참여, 분기, 신청,
 * 충전). 화면마다 색을 따로 고르면 같은 "승인"이 여기서는 초록, 저기서는
 * 회색이 됩니다. 어떤 색을 쓸지는 전부 `lib/admin.ts`와 `lib/quarters.ts`의
 * 표에서 가져옵니다.
 */

import {
  ACCOUNT_STATUS_BADGE,
  ACCOUNT_STATUS_LABEL,
  APPLICATION_STATUS_BADGE,
  TOP_UP_STATUS_BADGE,
  TOP_UP_STATUS_LABEL,
} from "@/lib/admin";
import type { AccountStatus } from "@/lib/auth";
import {
  APPLICATION_STATUS_LABEL,
  MEMBERSHIP_BADGE,
  MEMBERSHIP_LABEL,
  QUARTER_STATUS_BADGE,
  QUARTER_STATUS_LABEL,
  type ApplicationStatus,
  type MembershipStatus,
  type QuarterStatus,
  type TopUpStatus,
} from "@/lib/quarters";

export function AccountBadge({ status }: { status: AccountStatus }) {
  return (
    <span className={`badge ${ACCOUNT_STATUS_BADGE[status]}`}>
      {ACCOUNT_STATUS_LABEL[status]}
    </span>
  );
}

/** 참여 기록이 없으면(`null`) "미참여"입니다 — 비활동과 다릅니다. */
export function MembershipBadge({ status }: { status: MembershipStatus | null }) {
  if (status === null) return <span className="badge badge-mock">미참여</span>;
  return <span className={`badge ${MEMBERSHIP_BADGE[status]}`}>{MEMBERSHIP_LABEL[status]}</span>;
}

export function QuarterBadge({ status }: { status: QuarterStatus }) {
  return (
    <span className={`badge ${QUARTER_STATUS_BADGE[status]}`}>
      {QUARTER_STATUS_LABEL[status]}
    </span>
  );
}

export function ApplicationBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`badge ${APPLICATION_STATUS_BADGE[status]}`}>
      {APPLICATION_STATUS_LABEL[status]}
    </span>
  );
}

export function TopUpBadge({ status }: { status: TopUpStatus }) {
  return (
    <span className={`badge ${TOP_UP_STATUS_BADGE[status]}`}>{TOP_UP_STATUS_LABEL[status]}</span>
  );
}
