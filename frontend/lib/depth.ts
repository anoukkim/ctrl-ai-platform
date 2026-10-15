/**
 * 모델 + 생각 깊이(quality-tuning Q1) — Chat과 Builder가 같이 씁니다.
 *
 * 화면은 **모델 id와 깊이 이름만** 서버에 보냅니다. 깊이마다 얼마나 깊이
 * 생각하는지(effort), 얼마나 길게 쓸 수 있는지(max_tokens), 1회 최대
 * 금액은 모두 서버가 정합니다 — 여기 있는 숫자는 서버가 보내 준 것을
 * 보여 줄 뿐입니다.
 */

export type DepthLevel = "low" | "medium" | "high" | "max";

export const DEFAULT_DEPTH: DepthLevel = "medium";

export const DEPTH_LABEL: Record<DepthLevel, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
  max: "최고",
};

/** 생각 깊이 막대의 한 칸. 모델마다 서버가 보내 줍니다. */
export interface DepthOption {
  level: DepthLevel;
  label: string;
  hint: string;
  /** "1회 약 N원". 환율이 없으면 null. */
  estimate_krw: number | null;
  /** "(최대 M원)" — 이 깊이의 1회 한도. */
  max_krw: number;
}

/** 고르기 창의 모델 한 줄 — Chat과 Builder의 응답을 같은 모양으로. */
export interface PickerModel {
  id: number;
  label: string;
  description: string;
  admin_only: boolean;
  is_default: boolean;
  /** 보통 깊이의 "1회 약 N원". 환율이 없으면 null. */
  estimate_krw: number | null;
  /** "recent" — 최근 실제 답장의 중앙값(비용 보정). */
  estimate_basis?: "recent" | "formula";
  /** 비어 있으면 깊이 조절이 없는 모델(Haiku) — 막대를 숨깁니다. */
  levels: DepthOption[];
  /** 깊이 조절이 없는 모델의 1회 한도. */
  flat_max_krw: number;
  /** 한 깊이가 생각을 켜야 할 때의 한 줄(예: Sonnet 5.5의 최고). */
  depth_note: string;
}

export function isDepth(value: unknown): value is DepthLevel {
  return value === "low" || value === "medium" || value === "high" || value === "max";
}

/** 이 모델에서 실제로 쓰일 깊이 칸. 없는 깊이를 골랐으면 보통, 막대가 없으면 null. */
export function levelFor(model: PickerModel, level: DepthLevel | null | undefined): DepthOption | null {
  if (model.levels.length === 0) return null;
  return (
    model.levels.find((step) => step.level === level) ??
    model.levels.find((step) => step.level === DEFAULT_DEPTH) ??
    model.levels[0]
  );
}

/** 단추 글씨: "Sonnet 5.5 · 보통". 깊이가 없는 모델은 이름만. */
export function triggerText(model: PickerModel, level: DepthLevel | null | undefined): string {
  const step = levelFor(model, level);
  return step ? `${model.label} · ${step.label}` : model.label;
}

function won(krw: number): string {
  return `${krw.toLocaleString("ko-KR")}원`;
}

/** "1회 약 N원 (최대 M원)" — 고른 모델과 깊이의 값. */
export function priceText(model: PickerModel, level: DepthLevel | null | undefined): string {
  const step = levelFor(model, level);
  const estimate = step ? step.estimate_krw : model.estimate_krw;
  const max = step ? step.max_krw : model.flat_max_krw;
  if (estimate === null) return max > 0 ? `1회 최대 ${won(max)}` : "요금 정보 없음";
  return max > 0 ? `1회 약 ${won(estimate)} (최대 ${won(max)})` : `1회 약 ${won(estimate)}`;
}

/** 목록의 모델 줄 값: 보통 깊이 기준 "1회 약 N원". */
export function modelCostText(model: PickerModel): string {
  const step = levelFor(model, DEFAULT_DEPTH);
  const estimate = step ? step.estimate_krw : model.estimate_krw;
  if (estimate === null) return "요금 정보 없음";
  // 비용 보정: 최근 실제 답장의 중앙값이면 그렇다고 말합니다.
  return model.estimate_basis === "recent"
    ? `1회 약 ${won(estimate)} (최근 실제 기준)`
    : `1회 약 ${won(estimate)}`;
}

/** 영수증 앞머리: "Sonnet 5.5 · 높음". 깊이가 없으면 모델 이름만. */
export function receiptHead(modelLabel: string, depth: string | null | undefined): string {
  if (!modelLabel) return "";
  return isDepth(depth) ? `${modelLabel} · ${DEPTH_LABEL[depth]}` : modelLabel;
}
