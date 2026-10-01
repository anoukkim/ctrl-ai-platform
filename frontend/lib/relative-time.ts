/**
 * "2일 전" 같은 상대 시간.
 *
 * 댓글에는 정확한 날짜보다 얼마나 지났는지가 먼저 읽힙니다. 정확한
 * 날짜는 버리지 않고 `title`로 붙여 두니, 필요하면 가리켜서 볼 수
 * 있습니다 — 보이는 글자는 짧게, 사실은 그대로 남깁니다.
 *
 * 이 파일은 목업이 아닙니다. Phase 8에서 댓글이 실제로 저장되면 그때도
 * 같은 함수를 씁니다. 그래서 `lib/mock-data.ts`가 아니라 여기에 있습니다.
 *
 * `now`를 넘길 수 있게 둔 이유는 테스트입니다. 함수가 안에서 현재
 * 시각을 직접 읽으면 "3일 전"을 증명할 방법이 없습니다.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 날짜 문자열을 Date로 바꿉니다.
 *
 * `YYYY-MM-DD`처럼 시각이 없는 값은 **그 지역의 자정**으로 읽습니다.
 * `new Date("2026-09-26")`은 UTC 자정으로 읽혀서, 한국에서 보면 아홉
 * 시간 어긋납니다. 하루 단위로 세는 값에서는 그 아홉 시간이 "6일 전"을
 * "5일 전"으로 만들 수 있습니다.
 */
function parse(iso: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  return new Date(iso);
}

/** 가리켰을 때 보여 줄 정확한 날짜. 2026.09.26 형태입니다. */
export function exactDate(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", ".");
}

/**
 * 얼마나 지났는지를 한국어 한 조각으로 돌려줍니다.
 *
 * 한 달을 30일, 한 해를 365일로 셉니다. 달마다 길이가 다르지만, 이
 * 값은 "대충 두 달 전"을 읽히게 하려는 것이므로 달력대로 정확히 셀
 * 필요가 없습니다.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = parse(iso);
  const elapsed = now.getTime() - then.getTime();

  // 미래 날짜는 "방금 전"으로 둡니다. 목록을 망가뜨리지 않고, 시계가
  // 조금 어긋난 경우에 "-1일 전"처럼 읽히는 것을 막습니다.
  if (elapsed < MINUTE) return "방금 전";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}분 전`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}시간 전`;

  const days = Math.floor(elapsed / DAY);
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}
