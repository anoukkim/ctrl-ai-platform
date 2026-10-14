/**
 * 관리자 — 돈이 어디로 갔는지 (cost-clarity, 2026-10-14).
 *
 * 동아리 크레딧(제공자별 구매·사용·남은 크레딧 추정), 지급 vs 사용, 회원별
 * 표, 캐시 패널, CSV 내보내기, 분기 마감, Anthropic 비용 보고서 대조.
 * 모든 숫자는 백엔드의 장부에서 옵니다.
 */

import { API_BASE_URL } from "./api";
import { request } from "./http";

export interface ProviderCredit {
  provider: string;
  label: string;
  purchased_usd: string;
  paid_krw: number;
  purchases: number;
  used_usd: string;
  /** 회원에게 청구하지 않고 동아리가 낸 호출(실패한 빌더 생성 등). */
  absorbed_usd: string;
  used_krw: number;
  used_usd_quarter: string;
  used_krw_quarter: number;
  /** 추정 — 구매 합계 − 기록된 사용. 제공자 콘솔이 최종 기준입니다. */
  remaining_usd: string;
  /** 달러 비용이 기록되지 않은 건수(지금은 영상). 원화만 셉니다. */
  unpriced_events: number;
}

export interface CreditPurchase {
  id: number;
  provider: string;
  provider_label: string;
  purchased_on: string;
  amount_usd: string;
  paid_krw: number;
  memo: string;
  created_by_username: string;
  created_at: string;
}

export interface CreditOverview {
  providers: ProviderCredit[];
  purchases: CreditPurchase[];
  /** 대조에 쓰는 비용 보고서: "mock" | "anthropic". */
  report_provider: string;
}

export interface PurchaseInput {
  provider: string;
  purchased_on: string;
  amount_usd: string;
  paid_krw: number;
  memo: string;
}

export interface MemberMoneyRow {
  user_id: number;
  username: string;
  display_name: string;
  membership_status: string | null;
  granted_krw: number;
  consumed_krw: number;
  remaining_krw: number;
  chat_krw: number;
  build_krw: number;
  video_krw: number;
  other_krw: number;
  cache_saved_krw: number;
  adjusted_krw: number;
  carried_in_krw: number;
  frozen: boolean;
  reclaimed_krw: number | null;
  carry_over_krw: number | null;
}

export interface QuarterMoney {
  quarter_id: number;
  quarter_name: string;
  closed_at: string | null;
  carry_over_percent: number;
  granted_krw: number;
  charged_krw: number;
  unspent_krw: number;
  cache_saved_krw: number;
  absorbed_usd: string;
  members: MemberMoneyRow[];
}

export interface CacheRow {
  day: string;
  model_id: string;
  replies: number;
  hit_replies: number;
  hit_rate: number | null;
  input_tokens: number;
  write_tokens: number;
  read_tokens: number;
  write_krw: number;
  saved_krw: number;
  estimated: boolean;
}

export interface CloseLine {
  user_id: number;
  username: string;
  display_name: string;
  budget_krw: number;
  consumed_krw: number;
  reclaimed_krw: number;
  carry_over_krw: number;
}

export interface ClosePreview {
  quarter_id: number;
  quarter_name: string;
  carry_over_percent: number;
  closed: boolean;
  reclaimed_krw: number;
  carry_over_krw: number;
  lines: CloseLine[];
}

export interface ReconcileDay {
  day: string;
  ours_usd: string;
  anthropic_usd: string;
  difference_usd: string;
  matches: boolean;
}

export interface Reconcile {
  provider: string;
  start: string;
  end: string;
  ours_usd: string;
  anthropic_usd: string;
  days: ReconcileDay[];
}

export function getCredit(quarterId: number | null): Promise<CreditOverview> {
  return request<CreditOverview>(
    quarterId === null ? "/admin/credit" : `/admin/credit?quarter_id=${quarterId}`,
  );
}

export function recordPurchase(input: PurchaseInput): Promise<CreditPurchase> {
  return request<CreditPurchase>("/admin/credit/purchases", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getQuarterMoney(quarterId: number): Promise<QuarterMoney> {
  return request<QuarterMoney>(`/admin/quarters/${quarterId}/money`);
}

export function getCachePanel(days: number): Promise<CacheRow[]> {
  return request<CacheRow[]>(`/admin/cache-panel?days=${days}`);
}

export function getClosePreview(quarterId: number, percent: number): Promise<ClosePreview> {
  return request<ClosePreview>(
    `/admin/quarters/${quarterId}/close-preview?carry_over_percent=${percent}`,
  );
}

export function closeQuarter(quarterId: number, percent: number): Promise<ClosePreview> {
  return request<ClosePreview>(`/admin/quarters/${quarterId}/close`, {
    method: "POST",
    body: JSON.stringify({ carry_over_percent: percent }),
  });
}

export function reconcile(start: string, end: string): Promise<Reconcile> {
  return request<Reconcile>(`/admin/reconcile?start=${start}&end=${end}`);
}

/** CSV 내려받기 주소 — 같은 출처라 로그인 쿠키가 함께 갑니다. */
export const exportUrl = {
  members: (quarterId: number) => `${API_BASE_URL}/api/admin/export/members.csv?quarter_id=${quarterId}`,
  daily: (quarterId: number) => `${API_BASE_URL}/api/admin/export/daily.csv?quarter_id=${quarterId}`,
  purchases: () => `${API_BASE_URL}/api/admin/export/purchases.csv`,
  caching: (days: number) => `${API_BASE_URL}/api/admin/export/caching.csv?days=${days}`,
};

/** "$12.34" */
export function formatUsd(value: string | number): string {
  const number = typeof value === "number" ? value : Number(value);
  const sign = number < 0 ? "−" : "";
  return `${sign}$${Math.abs(number).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
