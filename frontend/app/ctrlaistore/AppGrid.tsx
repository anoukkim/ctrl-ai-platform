"use client";

/**
 * CtrlAIApps 목록과 검색.
 *
 * 앱 이름, 설명, 만든 사람으로 찾을 수 있고 분류와 정렬을 고를 수
 * 있습니다. 순위 알고리즘은 만들지 않습니다 — "인기"는 지금은 반응 수를
 * 더한 값입니다.
 *
 * 분류는 칩으로 고릅니다. 몇 개뿐이라 펼쳐 두면 한 번에 다 보이고 한 번에
 * 누를 수 있습니다. 정렬은 검색창 옆의 작은 고르기로 남깁니다.
 */

import { Heart, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { CreatorLine } from "@/app/components/Community";
import { MOCK_APPS, totalComments, totalReactions } from "@/lib/mock-data";

import styles from "./ctrlaistore.module.css";
import { softTint } from "./softTint";

type SortKey = "newest" | "popular" | "name";

const SORT_OPTIONS = [
  { value: "newest", label: "최신순" },
  { value: "popular", label: "인기순" },
  { value: "name", label: "이름순" },
];

export default function AppGrid() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const categories = Array.from(new Set(MOCK_APPS.map((app) => app.category)));

  const visible = MOCK_APPS.filter(
    (app) =>
      matchesQuery(query, app.name, app.description, app.tagline, app.creator.displayName) &&
      (category === "all" || app.category === category),
  ).sort((a, b) => {
    if (sort === "popular") return totalReactions(b.reactions) - totalReactions(a.reactions);
    if (sort === "name") return a.name.localeCompare(b.name, "ko");
    return b.publishedAt.localeCompare(a.publishedAt);
  });

  const categoryOptions = [
    { value: "all", label: "전체" },
    ...categories.map((value) => ({ value, label: value })),
  ];

  return (
    <>
      <div className={`toolbar ${styles.toolbar}`}>
        <div className="chips" role="group" aria-label="분류">
          {categoryOptions.map((option) => (
            <button
              className="chip"
              type="button"
              key={option.value}
              aria-pressed={category === option.value}
              onClick={() => setCategory(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className={styles.searchSlot}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="앱 이름, 설명, 만든 사람으로 검색"
            resultCount={visible.length}
            totalCount={MOCK_APPS.length}
            filters={[
              {
                key: "sort",
                label: "정렬",
                value: sort,
                onChange: (value) => setSort(value as SortKey),
                options: SORT_OPTIONS,
              },
            ]}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className={styles.searchEmpty}>
          <p>검색 결과가 없습니다. 다른 낱말로 찾아보세요.</p>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              setQuery("");
              setCategory("all");
            }}
          >
            검색 조건 지우기
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((app) => (
            <Link className={styles.card} href={`/ctrlaistore/${app.slug}`} key={app.slug}>
              <div
                className={styles.artwork}
                style={{ background: softTint(app.artwork) }}
              >
                <span className={styles.category}>{app.category}</span>
                <span className={styles.artworkText} aria-hidden="true">
                  {app.name}
                </span>
              </div>
              <div className={styles.body}>
                <h2 className={styles.name}>{app.name}</h2>
                <p className={styles.tagline}>{app.tagline}</p>
                <CreatorLine creator={app.creator} />
                <p className={styles.meta}>
                  <span className={styles.metaItem}>
                    <Heart size={12} aria-hidden="true" /> {totalReactions(app.reactions)}
                  </span>
                  <span className={styles.metaItem}>
                    <MessageCircle size={12} aria-hidden="true" /> {totalComments(app.comments)}
                  </span>
                  <span className={`${styles.metaItem} ${styles.metaDate}`}>{app.publishedAt}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
