/**
 * "썼어요" 알림 (feat-spend-feedback, 2026-10-14) — 백엔드와 주고받는 것.
 *
 * 금액은 언제나 백엔드가 그 작업에 대해 돌려준 `charged_krw`입니다 —
 * 화면의 어림값이 아닙니다. 이정표(첫 사용, 25/50/75%, 잔액 10,000원 이하,
 * 잔액 0)는 회원·분기마다 한 번씩만 보이도록 백엔드가 기록합니다.
 */

import { request } from "./http";

export type MilestoneKind = "first" | "used_25" | "used_50" | "used_75" | "low" | "empty";

export interface MilestoneClaim {
  milestone: MilestoneKind | null;
  budget_krw: number;
  consumed_krw: number;
  remaining_krw: number;
  percent_used: number;
}

/** 차감 뒤에 부릅니다. 새로 넘은 이정표 중 가장 높은 것 하나(없으면 null). */
export function claimMilestone(): Promise<MilestoneClaim | null> {
  return request<MilestoneClaim | null>("/usage/me/milestones", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export interface Preferences {
  spend_notifications: boolean;
}

export function setPreferences(input: Preferences): Promise<Preferences> {
  return request<Preferences>("/account/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** "claude-sonnet-5-5" → "Sonnet". 모르는 모델은 그대로. */
export function modelShortName(modelId: string | null | undefined): string {
  const match = /(haiku|sonnet|opus|fable)/i.exec(modelId ?? "");
  if (!match) return modelId ?? "";
  return match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
}

/** 이정표의 큰 글씨. */
export const MILESTONE_TITLE: Record<MilestoneKind, string> = {
  first: "첫 작품을 시작했어요 🎉",
  used_25: "지원금의 25%를 썼어요",
  used_50: "지원금의 절반을 썼어요",
  used_75: "지원금의 75%를 썼어요",
  low: "남은 지원금이 10,000원 이하예요",
  empty: "이번 분기 지원금을 다 썼어요",
};

/** 축하가 아니라 차분하게 알려야 하는 이정표. */
export function isWarning(kind: MilestoneKind): boolean {
  return kind === "low" || kind === "empty";
}

/** 몇 번의 차감을 합칠지 — 이 시간 안에 온 차감은 알림 하나로. */
export const MERGE_WINDOW_MS = 3000;
/** 알림이 떠 있는 시간(마지막 차감부터). */
export const TOAST_MS = 3000;
/** 이정표 카드가 떠 있는 시간. */
export const MILESTONE_MS = 6000;
