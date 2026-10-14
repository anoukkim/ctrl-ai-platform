/**
 * 분기 코드 "2026-Q4" → 이름과 날짜 (fix-quarter-form-autofill, 2026-10-14).
 *
 * 새 분기 양식이 코드 하나로 나머지 칸을 채웁니다. 날짜는 "YYYY-MM-DD"
 * 문자열로만 다룹니다 — Date 객체로 바꾸면 시간대 때문에 하루가 밀립니다.
 */

/** YYYY-Qn, n = 1–4. 소문자 q도 받아 대문자로 바꿉니다. */
const CODE = /^(\d{4})-Q([1-4])$/;

export const CODE_ERROR = "2026-Q4 꼴로 입력해 주세요";

export interface ParsedQuarter {
  code: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** "2026 Q4" */
  name: string;
  /** 분기 첫날, 예: 2026-10-01 */
  start: string;
  /** 분기 마지막 날, 예: 2026-12-31 */
  end: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 그 달의 마지막 날짜(윤년 포함). month는 1–12. */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseQuarterCode(raw: string): ParsedQuarter | null {
  const code = raw.trim().toUpperCase();
  const match = CODE.exec(code);
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]) as 1 | 2 | 3 | 4;
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  return {
    code,
    year,
    quarter,
    name: `${year} Q${quarter}`,
    start: `${year}-${pad(firstMonth)}-01`,
    end: `${year}-${pad(lastMonth)}-${pad(lastDay(year, lastMonth))}`,
  };
}

/** "YYYY-MM-DD"에 날짜를 더합니다(UTC로 계산해 하루 밀림이 없습니다). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** 오늘(한국 시간) "YYYY-MM-DD". */
export function todayKst(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export interface QuarterAutofill {
  display_name: string;
  starts_at: string;
  ends_at: string;
  application_opens_at: string;
  application_closes_at: string;
}

/**
 * 코드에서 채울 값. 신청 시작일은 오늘(분기가 아직 끝나지 않았다면) 아니면
 * 분기 첫날, 신청 마감일은 분기 첫날 + 30일. 다만 그날이 신청 시작일보다
 * 앞이면(분기 중간에 만들 때) 신청 시작일과 같게 둡니다 — 처음부터 틀린
 * 값을 채우지 않도록.
 */
export function autofill(parsed: ParsedQuarter, today: string = todayKst()): QuarterAutofill {
  const opens = today < parsed.end ? today : parsed.start;
  const closesByRule = addDays(parsed.start, 30);
  return {
    display_name: parsed.name,
    starts_at: parsed.start,
    ends_at: parsed.end,
    application_opens_at: opens,
    application_closes_at: closesByRule < opens ? opens : closesByRule,
  };
}
