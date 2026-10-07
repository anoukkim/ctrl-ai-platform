/**
 * 회원 탈퇴 — 회원 자신의 탈퇴와 Admin의 탈퇴 처리·복구·환불 기록.
 *
 * 두 화면(Profile과 Admin › 회원 상세)이 같은 규칙을 말해야 하므로
 * 타입, 호출, 그리고 확인창에 적을 문장까지 이 파일 하나에 둡니다.
 * 확인창의 문장을 화면마다 따로 쓰면, 한쪽만 고친 날 두 화면이 서로
 * 다른 결과를 약속하게 됩니다.
 */

import { request } from "./http";
import { formatKrw } from "./quarters";

export type PublishedWorkChoice = "keep" | "unpublish";

export type RefundStatus = "none" | "pending" | "recorded";

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  none: "환불 없음",
  pending: "환불 대기",
  recorded: "환불 완료",
};

export const REFUND_STATUS_BADGE: Record<RefundStatus, string> = {
  none: "badge-muted",
  pending: "badge-warn",
  recorded: "badge-ok",
};

export const PUBLISHED_WORK_LABEL: Record<PublishedWorkChoice, string> = {
  keep: "공개 유지 (탈퇴 회원으로 표시)",
  unpublish: "모두 게시 취소",
};

/** 탈퇴하면 생기는 일. 백엔드가 계산해서 줍니다. */
export interface WithdrawalPreview {
  released_krw: number;
  personal_remaining_krw: number;
  pending_top_ups: number;
  published_apps: number;
  published_videos: number;
  builder_projects: number;
  video_projects: number;
  grace_period_days: number;
  refund_hold: boolean;
  quarters: string[];
}

export interface Withdrawal {
  id: number;
  withdrawn_at: string;
  grace_ends_at: string;
  self_initiated: boolean;
  published_work: PublishedWorkChoice;
  released_krw: number;
  refund_status: RefundStatus;
  refund_amount_krw: number;
  refund_recorded_at: string | null;
  refund_reference: string;
  restored_at: string | null;
  anonymised_at: string | null;
  /** 복구 버튼을 보일지. 날짜 계산은 백엔드가 합니다 — 화면의 시계와
   *  서버의 시계가 다르면 버튼은 있는데 눌러지지 않는 날이 생깁니다. */
  can_restore: boolean;
}

// ------------------------------------------------------------ 회원

export function getMyWithdrawalPreview(): Promise<WithdrawalPreview> {
  return request<WithdrawalPreview>("/account/withdrawal");
}

export function withdrawMyAccount(
  password: string,
  publishedWork: PublishedWorkChoice,
): Promise<Withdrawal> {
  return request<Withdrawal>("/account/withdrawal", {
    method: "POST",
    body: JSON.stringify({ password, published_work: publishedWork }),
  });
}

// ------------------------------------------------------------ Admin

export function getMemberWithdrawalPreview(userId: number): Promise<WithdrawalPreview> {
  return request<WithdrawalPreview>(`/admin/members/${userId}/withdrawal`);
}

export function withdrawMember(
  userId: number,
  publishedWork: PublishedWorkChoice,
): Promise<Withdrawal> {
  return request<Withdrawal>(`/admin/members/${userId}/withdrawal`, {
    method: "POST",
    body: JSON.stringify({ published_work: publishedWork }),
  });
}

export function restoreMember(userId: number): Promise<Withdrawal> {
  return request<Withdrawal>(`/admin/members/${userId}/withdrawal/restore`, { method: "POST" });
}

export function recordRefund(userId: number, reference: string): Promise<Withdrawal> {
  return request<Withdrawal>(`/admin/members/${userId}/withdrawal/refund`, {
    method: "POST",
    body: JSON.stringify({ reference }),
  });
}

// ------------------------------------------------------------ 확인창 문장

/**
 * 탈퇴 확인창에 적을 것, 한 줄에 하나씩.
 *
 * "정말 탈퇴하시겠습니까?"가 아니라 실제로 일어날 일을 적습니다. 회원이
 * 직접 하든 관리자가 하든 일어나는 일은 같으므로 문장도 같고, 주어만
 * 다릅니다.
 */
export function withdrawalEffects(
  preview: WithdrawalPreview,
  choice: PublishedWorkChoice,
  subject: "self" | "admin" = "self",
): string[] {
  const who = subject === "self" ? "" : "이 회원은 ";
  const lines = [
    `${who}바로 로그아웃되고, 이후 로그인할 수 없습니다.`,
  ];

  if (preview.released_krw > 0) {
    lines.push(
      `남은 동아리 지원 ${formatKrw(preview.released_krw)}` +
        (preview.quarters.length ? `(${preview.quarters.join(", ")})` : "") +
        "은 해제되어 더 이상 쓸 수 없습니다.",
    );
  } else {
    lines.push("남은 동아리 지원이 없어 해제할 금액이 없습니다.");
  }

  if (preview.refund_hold) {
    const parts: string[] = [];
    if (preview.personal_remaining_krw > 0) {
      parts.push(`개인 충전 잔액 ${formatKrw(preview.personal_remaining_krw)}`);
    }
    if (preview.pending_top_ups > 0) {
      parts.push(`확인 전인 충전 요청 ${preview.pending_top_ups}건`);
    }
    lines.push(
      `${parts.join("과 ")}이 있어 '환불 대기'가 됩니다. 관리자가 환불을 기록할 때까지 계정 정리가 끝나지 않습니다.`,
    );
  }

  const published = preview.published_apps + preview.published_videos;
  if (choice === "unpublish") {
    lines.push(
      published > 0
        ? `게시한 작품 ${published}개(앱 ${preview.published_apps}, 영상 ${preview.published_videos})를 모두 게시 취소합니다.`
        : "게시한 작품이 없어 게시 취소할 것이 없습니다.",
    );
  } else {
    lines.push(
      published > 0
        ? `게시한 작품 ${published}개는 공개된 채로 남고, 만든 사람은 '탈퇴 회원'으로 표시됩니다.`
        : "게시한 작품은 앞으로도 '탈퇴 회원'으로 표시됩니다.",
    );
  }

  lines.push(
    `사용 기록은 분기 정산을 위해 그대로 남습니다.`,
    `${preview.grace_period_days}일 안에는 관리자가 계정을 복구할 수 있습니다. ` +
      `${preview.grace_period_days}일이 지나면 아이디·이메일·이름이 삭제되고 복구할 수 없습니다.`,
  );

  return lines;
}
