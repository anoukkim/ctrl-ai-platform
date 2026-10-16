/**
 * 초대 코드 — Admin › Members의 "초대 코드" 칸 (invite-only-signup).
 *
 * 코드 상태는 백엔드가 정해서 보냅니다. 같은 규칙(중지 → 만료 → 소진 →
 * 사용 가능)을 브라우저에 한 벌 더 두면 둘 중 하나만 고쳐집니다.
 */

import { request } from "./http";

export type InviteStatus = "usable" | "expired" | "exhausted" | "disabled";

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  usable: "사용 가능",
  expired: "만료",
  exhausted: "소진",
  disabled: "중지",
};

export const INVITE_STATUS_BADGE: Record<InviteStatus, string> = {
  usable: "badge-ok",
  expired: "badge-muted",
  exhausted: "badge-warn",
  disabled: "badge-error",
};

export interface InviteSignup {
  user_id: number;
  username: string;
  display_name: string;
  signed_up_at: string;
}

export interface Invite {
  id: number;
  code: string;
  label: string;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  is_active: boolean;
  status: InviteStatus;
  created_by_username: string;
  created_at: string;
  signups: InviteSignup[];
}

export interface NewInvite {
  /** 비워 두면 읽기 쉬운 코드를 만들어 줍니다. */
  code: string;
  label: string;
  max_uses: number;
  /** ISO 시각. null이면 만료 없음. */
  expires_at: string | null;
}

export function listInvites(): Promise<Invite[]> {
  return request<Invite[]>("/admin/invites");
}

export function createInvite(input: NewInvite): Promise<Invite> {
  return request<Invite>("/admin/invites", { method: "POST", body: JSON.stringify(input) });
}

export function setInviteActive(id: number, active: boolean): Promise<Invite> {
  return request<Invite>(`/admin/invites/${id}/${active ? "reactivate" : "deactivate"}`, {
    method: "POST",
  });
}

/** 최대 가입 수를 나중에 바꿉니다 — 이미 가입한 수 아래로는 백엔드가 거절합니다 (owner-polish 1). */
export function updateInviteMaxUses(id: number, maxUses: number): Promise<Invite> {
  return request<Invite>(`/admin/invites/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ max_uses: maxUses }),
  });
}

/** 코드가 미리 채워진 가입 링크. 관리자가 복사해 나눠 줍니다. */
export function signupLink(origin: string, code: string): string {
  return `${origin}/signup?code=${encodeURIComponent(code)}`;
}
