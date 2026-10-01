/**
 * "2일 전"이 맞게 나오는지.
 *
 * 순수한 계산이라 여기서 제대로 증명됩니다. `now`를 넘길 수 있게 만들어
 * 둔 것이 이 테스트의 전제입니다 — 함수가 안에서 현재 시각을 읽으면
 * 하루 지난 뒤부터 테스트가 다른 답을 내놓습니다.
 */

import { describe, expect, test } from "vitest";

import { exactDate, relativeTime } from "@/lib/relative-time";

/** 테스트의 "지금". 2026년 10월 2일 오후 3시. */
const NOW = new Date(2026, 9, 2, 15, 0, 0);

describe("relativeTime", () => {
  test.each([
    ["2026-10-02", "15시간 전"],
    ["2026-10-01", "1일 전"],
    ["2026-09-30", "2일 전"],
    ["2026-09-26", "6일 전"],
    ["2026-09-25", "1주 전"],
    ["2026-09-08", "3주 전"],
    ["2026-07-08", "2개월 전"],
    ["2025-07-08", "1년 전"],
  ])("%s는 %s", (iso, expected) => {
    expect(relativeTime(iso, NOW)).toBe(expected);
  });

  test("방금 쓴 댓글은 '방금 전'", () => {
    expect(relativeTime(new Date(NOW.getTime() - 5000).toISOString(), NOW)).toBe("방금 전");
  });

  test("분과 시간도 센다", () => {
    expect(relativeTime(new Date(NOW.getTime() - 90 * 1000).toISOString(), NOW)).toBe("1분 전");
    expect(relativeTime(new Date(NOW.getTime() - 3 * 3600 * 1000).toISOString(), NOW)).toBe(
      "3시간 전",
    );
  });

  test("날짜만 있는 값은 그 지역의 자정으로 읽는다", () => {
    // `new Date("2026-09-26")`은 UTC 자정이라 한국에서 보면 아홉 시간
    // 어긋나고, 그 아홉 시간이 "6일 전"을 "5일 전"으로 만듭니다.
    expect(relativeTime("2026-09-26", new Date(2026, 9, 2, 0, 30))).toBe("6일 전");
  });

  test("시계가 앞서 있어도 '-1일 전'은 나오지 않는다", () => {
    expect(relativeTime("2026-10-05", NOW)).toBe("방금 전");
  });
});

describe("exactDate", () => {
  test("가리켰을 때 보여 줄 날짜", () => {
    expect(exactDate("2026-09-26")).toBe("2026.09.26");
    expect(exactDate("2026-09-26T11:22:33.000Z")).toBe("2026.09.26");
  });
});
