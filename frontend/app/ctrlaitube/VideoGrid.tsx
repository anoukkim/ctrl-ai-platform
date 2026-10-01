"use client";

/**
 * CtrlAITube 피드와 검색.
 *
 * 제목, 설명, 만든 사람으로 찾습니다. 정렬은 최신순/인기순 정도만 두고,
 * 복잡한 추천 알고리즘은 만들지 않습니다.
 */

import { Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { CreatorLine } from "@/app/components/Community";
import { MOCK_VIDEOS, totalComments, totalReactions } from "@/lib/mock-data";

import styles from "./tube.module.css";

type SortKey = "newest" | "popular";

const SORT_OPTIONS = [
  { value: "newest", label: "최신순" },
  { value: "popular", label: "인기순" },
];

export default function VideoGrid() {
  const [query, setQuery] = useState("");
  const [creator, setCreator] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const creators = Array.from(
    new Map(MOCK_VIDEOS.map((v) => [v.creator.username, v.creator.displayName])).entries(),
  );

  const visible = MOCK_VIDEOS.filter(
    (video) =>
      matchesQuery(query, video.title, video.description, video.creator.displayName) &&
      (creator === "all" || video.creator.username === creator),
  ).sort((a, b) => {
    if (sort === "popular") return totalReactions(b.reactions) - totalReactions(a.reactions);
    return b.publishedAt.localeCompare(a.publishedAt);
  });

  return (
    <>
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="영상 제목, 설명, 만든 사람으로 검색"
        resultCount={visible.length}
        totalCount={MOCK_VIDEOS.length}
        filters={[
          {
            key: "creator",
            label: "만든 사람",
            value: creator,
            onChange: setCreator,
            options: [
              { value: "all", label: "전체" },
              ...creators.map(([username, displayName]) => ({
                value: username,
                label: displayName,
              })),
            ],
          },
          {
            key: "sort",
            label: "정렬",
            value: sort,
            onChange: (value) => setSort(value as SortKey),
            options: SORT_OPTIONS,
          },
        ]}
      />

      {visible.length === 0 ? (
        <div className={styles.searchEmpty}>
          <p>검색 결과가 없습니다. 다른 낱말로 찾아보세요.</p>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              setQuery("");
              setCreator("all");
            }}
          >
            검색 조건 지우기
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((video) => (
            <Link className={styles.card} href={`/ctrlaitube/${video.id}`} key={video.id}>
              <div
                className={styles.thumbnail}
                style={{
                  background: `linear-gradient(140deg, ${video.artwork[0]}, ${video.artwork[1]})`,
                }}
              >
                <span className={styles.playGlyph} aria-hidden="true">
                  <Play size={14} aria-hidden="true" />
                </span>
                <span className={styles.duration}>{video.duration}</span>
              </div>
              <div className={styles.cardBody}>
                <h2 className={styles.title}>{video.title}</h2>
                <CreatorLine creator={video.creator} />
                <p className={styles.meta}>
                  <span>♥ {totalReactions(video.reactions)}</span>
                  <span>💬 {totalComments(video.comments)}</span>
                  <span>{video.publishedAt}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
