"use client";

/**
 * CtrlAITube 피드와 검색.
 *
 * 제목, 설명, 만든 사람으로 찾습니다. 정렬은 최신순/인기순 정도만 두고,
 * 복잡한 추천 알고리즘은 만들지 않습니다.
 *
 * 정렬은 둘뿐이라 칩으로 펼쳐 두고, 만든 사람 거르기는 검색창 옆의 작은
 * 고르기로 남깁니다.
 *
 * promo-videos: 맨 앞 카드는 **실제 영상**(백엔드의 `tube_videos` —
 * CTRL+AI 소개 영상, 공식 꼬리표)이고, 반응·댓글 수도 저장된 값입니다.
 * 나머지 카드는 아직 예시입니다(Phase 8).
 */

import { Heart, MessageCircle, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { CreatorLine } from "@/app/components/Community";
import { MOCK_VIDEOS, totalComments, totalReactions } from "@/lib/mock-data";
import { exactDate } from "@/lib/relative-time";
import { formatDuration, listTubeVideos, type TubeVideo } from "@/lib/tube";

import { softTint } from "@/app/ctrlaistore/softTint";

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
  const [real, setReal] = useState<TubeVideo[]>([]);

  useEffect(() => {
    listTubeVideos()
      .then(setReal)
      .catch(() => setReal([])); // 서버가 없으면 예시만 — 목록은 그래도 뜹니다
  }, []);

  // 실제 영상은 검색에만 걸리고 정렬·만든 사람 거르기와 상관없이 맨 앞입니다.
  const realVisible = real.filter(
    (video) => creator === "all" && matchesQuery(query, video.title, video.description, "CTRL+AI"),
  );

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
      <div className={`toolbar ${styles.toolbar}`}>
        <div className="chips" role="group" aria-label="정렬">
          {SORT_OPTIONS.map((option) => (
            <button
              className="chip"
              type="button"
              key={option.value}
              aria-pressed={sort === option.value}
              onClick={() => setSort(option.value as SortKey)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className={styles.searchSlot}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="영상 제목, 설명, 만든 사람으로 검색"
            resultCount={visible.length + realVisible.length}
            totalCount={MOCK_VIDEOS.length + real.length}
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
            ]}
          />
        </div>
      </div>

      {visible.length + realVisible.length === 0 ? (
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
          {realVisible.map((video) => (
            <Link className={styles.card} href={`/ctrlaitube/${video.slug}`} key={video.slug} data-testid="official-card">
              <div className={styles.thumbnail}>
                {/* 포스터: 영상의 첫 장면. 가로 파일의 것이 카드 비율에 맞습니다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.poster} src={video.poster_desktop_src} alt="" />
                <span className={styles.playGlyph} aria-hidden="true">
                  <Play size={14} fill="currentColor" aria-hidden="true" />
                </span>
                <span className={styles.duration}>{formatDuration(video.duration_seconds)}</span>
              </div>
              <div className={styles.cardBody}>
                <h2 className={styles.title}>
                  {video.title} {video.official && <span className="badge badge-accent">공식</span>}
                </h2>
                <span className={styles.official}>
                  <span className="muted">만든 사람</span> {video.creator?.display_name ?? "CTRL+AI"}
                </span>
                <p className={styles.meta}>
                  <span className={styles.metaItem}>
                    <Heart size={12} aria-hidden="true" /> {totalReactions(video.reactions)}
                  </span>
                  <span className={styles.metaItem}>
                    <MessageCircle size={12} aria-hidden="true" /> {video.comment_count}
                  </span>
                  <span className={`${styles.metaItem} ${styles.metaDate}`}>{exactDate(video.published_at)}</span>
                </p>
              </div>
            </Link>
          ))}
          {visible.map((video) => (
            <Link className={styles.card} href={`/ctrlaitube/${video.id}`} key={video.id}>
              <div
                className={styles.thumbnail}
                style={{ background: softTint(video.artwork) }}
              >
                <span className={styles.playGlyph} aria-hidden="true">
                  <Play size={14} fill="currentColor" aria-hidden="true" />
                </span>
                <span className={styles.duration}>{video.duration}</span>
              </div>
              <div className={styles.cardBody}>
                <h2 className={styles.title}>{video.title}</h2>
                <CreatorLine creator={video.creator} />
                <p className={styles.meta}>
                  <span className={styles.metaItem}>
                    <Heart size={12} aria-hidden="true" /> {totalReactions(video.reactions)}
                  </span>
                  <span className={styles.metaItem}>
                    <MessageCircle size={12} aria-hidden="true" /> {totalComments(video.comments)}
                  </span>
                  <span className={`${styles.metaItem} ${styles.metaDate}`}>{video.publishedAt}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
