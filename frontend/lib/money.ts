/**
 * 돈이 어디로 갔는지 (cost-clarity, 2026-10-14) — 화면 여러 곳이 같이 쓰는
 * 표기와 설명.
 *
 * 항목별 금액(입력, 캐시 쓰기, 캐시 읽기, 출력, 도구)은 반올림하지 않은
 * 값이라 몇 원 단위 아래까지 있습니다. 실제로 지갑에서 빠지는 금액(합계)은
 * 그 합을 답장마다 한 번 **올림**한 것이라, 항목을 더한 값보다 1원 안쪽으로
 * 클 수 있습니다.
 */

/** 항목별 금액: 10원 미만은 소수 한 자리(0.4원), 그 이상은 원 단위. */
export function formatWonPart(value: number): string {
  if (value === 0) return "0원";
  if (Math.abs(value) < 10) {
    const rounded = Math.round(value * 10) / 10;
    return rounded === 0 ? "0.1원 미만" : `${rounded.toLocaleString("ko-KR")}원`;
  }
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

/**
 * 캐싱을 회원에게 설명하는 두 문장 — 답장 영수증의 ⓘ, Usage 화면,
 * docs/api-distribution.md가 같은 문장을 씁니다.
 */
export const CACHE_EXPLAINER =
  "캐시는 지시문과 지난 대화처럼 매번 다시 보내는 앞부분을 Claude가 몇 분 동안 기억해 두는 기능이에요. " +
  "기억해 둔 부분을 다시 읽을 때는 처음보다 훨씬 싸게(모델에 따라 10분의 1~20분의 1) 계산되고, 처음 기억해 둘 때만 조금 더(1.25배) 들어요.";

/** 합계가 항목의 합보다 조금 큰 이유 — 영수증과 Usage의 각주. */
export const ROUND_UP_NOTE = "합계는 항목을 더한 뒤 답장마다 1원 단위로 올림한 금액이에요.";

/** 항목의 이름, 표시 순서대로. */
export const PART_LABELS = {
  input: "입력",
  cache_write: "캐시 쓰기",
  cache_read: "캐시 읽기",
  output: "출력",
  tools: "도구",
  other: "기타",
} as const;

/** 서버의 항목별 합계(SplitRead). */
export interface MoneySplit {
  input_krw: number;
  cache_write_krw: number;
  cache_read_krw: number;
  output_krw: number;
  tools_krw: number;
  other_krw: number;
  cache_saved_krw: number;
  charged_krw: number;
  events: number;
  estimated: boolean;
}

/** 0이 아닌 항목만, "입력 0.6원 · 출력 4.2원"처럼. */
export function splitLine(split: MoneySplit): string {
  const parts: string[] = [];
  const pairs: [keyof typeof PART_LABELS, number][] = [
    ["input", split.input_krw],
    ["cache_write", split.cache_write_krw],
    ["cache_read", split.cache_read_krw],
    ["output", split.output_krw],
    ["tools", split.tools_krw],
    ["other", split.other_krw],
  ];
  for (const [key, value] of pairs) {
    if (value > 0) parts.push(`${PART_LABELS[key]} ${formatWonPart(value)}`);
  }
  return parts.join(" · ");
}
