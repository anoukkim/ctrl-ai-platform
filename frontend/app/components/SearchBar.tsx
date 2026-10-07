"use client";

/**
 * 목록 화면에서 함께 쓰는 검색창과 필터.
 *
 * Phase 1에서는 브라우저 안에서 거릅니다. 데이터가 아직 적고, 화면이
 * 이미 목록 전체를 가지고 있기 때문입니다. 나중에 서버 검색으로 옮기기
 * 쉽도록 입력값만 바깥으로 올려 주고, 거르는 일은 호출하는 쪽이 합니다.
 * (검색어를 서버로 보내는 방식으로 바꿀 때 이 컴포넌트는 그대로 둡니다.)
 *
 * 전역 검색은 만들지 않습니다. 화면마다 그 화면에 맞는 검색을 둡니다.
 */

import { Search, X } from "lucide-react";
import { useId } from "react";

import styles from "./SearchBar.module.css";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSpec {
  /** 상태값 등 무엇을 거르는지 */
  key: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** 거른 뒤 남은 개수. 전체와 다를 때만 보여 줍니다. */
  resultCount?: number;
  totalCount?: number;
  filters?: FilterSpec[];
}

export default function SearchBar({
  value,
  onChange,
  placeholder,
  resultCount,
  totalCount,
  filters = [],
}: Props) {
  const inputId = useId();
  const narrowed =
    resultCount !== undefined && totalCount !== undefined && resultCount !== totalCount;

  return (
    <div className={styles.bar}>
      <div className={styles.searchWrap}>
        <Search className={styles.glyph} size={15} aria-hidden="true" />
        <input
          className={`field ${styles.input}`}
          id={inputId}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {value && (
          <button
            className={styles.clear}
            type="button"
            onClick={() => onChange("")}
            aria-label="검색어 지우기"
          >
            <X size={11} aria-hidden="true" />
          </button>
        )}
      </div>

      {filters.map((filter) => (
        <label className={styles.filter} key={filter.key}>
          <span className={styles.filterLabel}>{filter.label}</span>
          <select
            className={`field ${styles.select}`}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
          >
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {narrowed && (
        <span className={styles.count} role="status">
          {resultCount}개 / 전체 {totalCount}개
        </span>
      )}
    </div>
  );
}

/**
 * 검색어가 주어진 글자들 중 하나에라도 들어 있는지.
 *
 * 한글은 대소문자가 없지만 영어 이름과 모델 id가 섞여 있으므로 소문자로
 * 맞춘 뒤 비교합니다.
 */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}
