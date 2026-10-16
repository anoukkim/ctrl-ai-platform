/**
 * ui-improvements — 목록 정렬의 규칙과 기억.
 *
 * 고정(즐겨찾기)한 것이 늘 먼저이고, 그 안에서 마지막 수정순(기본) 또는
 * 이름순. 고른 순서는 화면마다 이 기기에 남습니다.
 */

import { beforeEach, describe, expect, test } from "vitest";

import { forgetPrefsInMemory } from "@/lib/layout-prefs";
import { readSortPref, sortItems, writeSortPref } from "@/lib/list-sort";

const items: { name: string; updated: string | null; pinned: boolean }[] = [
  { name: "나 두 번째", updated: "2026-10-02T00:00:00Z", pinned: false },
  { name: "가 가장 오래됨", updated: "2026-10-01T00:00:00Z", pinned: true },
  { name: "다 최신", updated: "2026-10-03T00:00:00Z", pinned: false },
  { name: "라 고정 최신", updated: "2026-10-04T00:00:00Z", pinned: true },
];

const names = (list: typeof items) => list.map((item) => item.name.slice(0, 1));

describe("sortItems", () => {
  test("고정 먼저, 그 안에서 마지막 수정순", () => {
    expect(names(sortItems(items, "updated", (item) => item))).toEqual(["라", "가", "다", "나"]);
  });

  test("이름순도 고정이 먼저", () => {
    expect(names(sortItems(items, "name", (item) => item))).toEqual(["가", "라", "나", "다"]);
  });

  test("원본은 그대로이고, 날짜가 없는 것은 맨 뒤", () => {
    const withBlank = [...items, { name: "마 날짜 없음", updated: null, pinned: false }];
    const sorted = sortItems(withBlank, "updated", (item) => item);
    expect(names(sorted).at(-1)).toBe("마");
    expect(names(withBlank)).toEqual(["나", "가", "다", "라", "마"]);
  });
});

describe("기억", () => {
  beforeEach(() => {
    forgetPrefsInMemory();
    window.localStorage.clear();
  });

  test("기본은 마지막 수정순, 화면마다 따로 기억한다", () => {
    expect(readSortPref("builder")).toBe("updated");
    writeSortPref("builder", "name");
    expect(readSortPref("builder")).toBe("name");
    expect(readSortPref("apps")).toBe("updated");
    expect(window.localStorage.getItem("ctrlai.builder.list-sort.builder")).toBe("name");
  });

  test("이상한 값은 기본으로 읽는다", () => {
    window.localStorage.setItem("ctrlai.builder.list-sort.video", "weird");
    expect(readSortPref("video")).toBe("updated");
  });
});
