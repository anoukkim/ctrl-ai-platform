/**
 * 목록 정렬 (ui-improvements) — Project Builder · CtrlAIApps · Video Generator.
 *
 * 규칙은 하나: **고정(즐겨찾기)한 것이 먼저**, 그 안에서 고른 순서로. 순서는
 * 두 가지뿐입니다 — 마지막 수정순(기본)과 이름순. 고른 순서는 화면마다
 * 이 기기에 기억합니다(layout-prefs와 같은 방식, 마이그레이션 없음).
 */

import { readPref, usePref, writePref } from "./layout-prefs";

export type SortKey = "updated" | "name";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "마지막 수정순" },
  { value: "name", label: "이름순" },
];

export const DEFAULT_SORT: SortKey = "updated";

export function sortLabel(key: SortKey): string {
  return SORT_OPTIONS.find((option) => option.value === key)?.label ?? SORT_OPTIONS[0].label;
}

function prefKey(screen: string): string {
  return `list-sort.${screen}`;
}

function asSortKey(value: string | null): SortKey {
  return value === "name" ? "name" : DEFAULT_SORT;
}

/** 이 화면에서 고른 순서. 서버와 첫 화면에서는 기본값. */
export function useSortPref(screen: string): SortKey {
  return asSortKey(usePref(prefKey(screen)));
}

export function readSortPref(screen: string): SortKey {
  return asSortKey(readPref(prefKey(screen)));
}

export function writeSortPref(screen: string, key: SortKey): void {
  writePref(prefKey(screen), key);
}

export interface SortFields {
  name: string;
  /** ISO 날짜. 비어 있으면 가장 오래된 것으로 칩니다. */
  updated: string | null | undefined;
  pinned: boolean;
}

const collator = new Intl.Collator("ko", { sensitivity: "base", numeric: true });

/**
 * 고정 먼저, 그다음 고른 순서. 같은 값끼리는 원래 순서를 지킵니다(안정
 * 정렬). 원본 배열은 바꾸지 않습니다.
 */
export function sortItems<T>(items: readonly T[], key: SortKey, fields: (item: T) => SortFields): T[] {
  return items
    .map((item, index) => ({ item, index, fields: fields(item) }))
    .sort((a, b) => {
      if (a.fields.pinned !== b.fields.pinned) return a.fields.pinned ? -1 : 1;
      let order = 0;
      if (key === "name") {
        order = collator.compare(a.fields.name, b.fields.name);
      } else {
        order = (b.fields.updated ?? "").localeCompare(a.fields.updated ?? "");
      }
      return order !== 0 ? order : a.index - b.index;
    })
    .map((entry) => entry.item);
}
