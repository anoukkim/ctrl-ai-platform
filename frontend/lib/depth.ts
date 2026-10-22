/**
 * 모델 + 생각 깊이(quality-tuning Q1) — Chat과 Builder가 같이 씁니다.
 *
 * 화면은 **모델 id와 깊이 이름만** 서버에 보냅니다. 깊이마다 얼마나 깊이
 * 생각하는지(effort), 얼마나 길게 쓸 수 있는지(max_tokens), 1회 최대
 * 금액은 모두 서버가 정합니다 — 여기 있는 숫자는 서버가 보내 준 것을
 * 보여 줄 뿐입니다.
 */

/**
 * auto-depth (owner, 2026-10-22): "auto" — 자동, the default. The server
 * picks 낮음 · 보통 · 높음 for each request; 최고 is only ever the member's
 * own choice.
 */
export type DepthLevel = "auto" | "low" | "medium" | "high" | "max";

export const DEFAULT_DEPTH: DepthLevel = "auto";

/** The slider's middle — where turning 자동 off lands. */
export const MANUAL_DEFAULT: DepthLevel = "medium";

export const DEPTH_LABEL: Record<DepthLevel, string> = {
  auto: "자동",
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
  /** 길어진 답장을 서버가 이어 쓸 때의 전체 상한(feat-auto-continue). 0이면 한 번만. */
  total_krw?: number;
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
  /** 자동 스위치(보통의 어림값, 높음의 1회 한도). 깊이가 없는 모델은 null. */
  auto?: DepthOption | null;
  /** 깊이 조절이 없는 모델의 1회 한도. */
  flat_max_krw: number;
  /** 한 깊이가 생각을 켜야 할 때의 한 줄(예: Sonnet 5.5의 최고). */
  depth_note: string;
}

export function isDepth(value: unknown): value is DepthLevel {
  return value === "auto" || value === "low" || value === "medium" || value === "high" || value === "max";
}

/**
 * 이 모델에서 쓰일 깊이: 자동(또는 아무것도 고르지 않음)이면 자동 칸,
 * 막대의 깊이면 그 칸, 없는 깊이면 보통. 깊이가 없는 모델은 null.
 */
export function levelFor(model: PickerModel, level: DepthLevel | null | undefined): DepthOption | null {
  if (model.levels.length === 0) return null;
  if ((level === "auto" || level === null || level === undefined) && model.auto) return model.auto;
  return (
    model.levels.find((step) => step.level === level) ??
    model.levels.find((step) => step.level === MANUAL_DEFAULT) ??
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

/** 길면 자동으로 이어 쓴다는 한 줄 — 전체 상한이 1회 한도보다 클 때만. */
export function continueText(model: PickerModel, level: DepthLevel | null | undefined): string {
  const step = levelFor(model, level);
  const total = step?.total_krw ?? 0;
  if (!step || total <= step.max_krw) return "";
  return `길면 자동으로 이어 써요 · 전체 최대 ${won(total)}`;
}

/** 목록의 모델 줄 값: 지금 고른 깊이에서의 "1회 약 N원"(그 깊이가 없으면 보통). */
export function modelCostText(model: PickerModel, level: DepthLevel | null = DEFAULT_DEPTH): string {
  const step = levelFor(model, level);
  const estimate = step ? step.estimate_krw : model.estimate_krw;
  if (estimate === null) return "요금 정보 없음";
  // 비용 보정: 최근 실제 답장의 중앙값이면 그렇다고 말합니다.
  return model.estimate_basis === "recent"
    ? `1회 약 ${won(estimate)} (최근 실제 기준)`
    : `1회 약 ${won(estimate)}`;
}

/**
 * 영수증 앞머리: "Sonnet 5.5 · 높음", 자동이 고른 깊이면 "Sonnet 5.5 · 자동 · 높음".
 * 깊이가 없으면 모델 이름만.
 */
export function receiptHead(modelLabel: string, depth: string | null | undefined, auto = false): string {
  if (!modelLabel) return "";
  if (!isDepth(depth)) return modelLabel;
  return auto && depth !== "auto" ? `${modelLabel} · 자동 · ${DEPTH_LABEL[depth]}` : `${modelLabel} · ${DEPTH_LABEL[depth]}`;
}
