"use client";

/**
 * 목록 머리 줄의 정렬 단추 (ui-improvements) — "정렬: 마지막 수정순 ▾".
 *
 * 누르면 두 항목(마지막 수정순 · 이름순)이 열리고, 고른 것에 ✓가 붙습니다.
 * 고른 순서는 호출하는 쪽이 기억합니다(lib/list-sort).
 */

import { ArrowUpDown } from "lucide-react";

import { SORT_OPTIONS, sortLabel, type SortKey } from "@/lib/list-sort";

import MenuButton from "./MenuButton";

interface Props {
  value: SortKey;
  onChange: (key: SortKey) => void;
}

export default function SortMenu({ value, onChange }: Props) {
  return (
    <MenuButton
      className="btn btn-sm"
      label={`정렬: ${sortLabel(value)}`}
      title="목록 순서 — 고정한 것은 늘 먼저예요"
      items={SORT_OPTIONS.map((option) => ({
        label: `${option.value === value ? "✓ " : ""}${option.label}`,
        onSelect: () => onChange(option.value),
      }))}
    >
      <ArrowUpDown size={14} aria-hidden="true" />
      <span data-testid="sort-label">{sortLabel(value)}</span>
    </MenuButton>
  );
}
