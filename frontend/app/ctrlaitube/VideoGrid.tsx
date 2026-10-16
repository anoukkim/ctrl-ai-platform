"use client";

/**
 * CtrlAITube 피드와 검색.
 *
 * 목록은 백엔드의 영상(`tube_videos`)입니다 — 지금은 CTRL+AI 소개 영상
 * 하나(공식, 9:16 세로 편). 예시 카드 세 장은 오너의 뜻대로 지웠습니다
 * (fix-promo-video-placement, 2026-10-16): 목록에 실제가 아닌 것은 없습니다.
 * 회원들의 YouTube 영상은 Phase 8에서 같은 표에 들어옵니다.
 *
 * 세로 영상의 카드는 세로 포스터를 씁니다. 썸네일 칸은 3:4 — 9:16을 그대로
 * 두면 카드가 너무 길고, 16:10으로 자르면 글자가 잘립니다.
 */

import { Heart, MessageCircle, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { describeError } from "@/lib/http";
import { exactDate } from "@/lib/relative-time";
import { formatDuration, listTubeVideos, type TubeVideo } from "@/lib/tube";

import styles from "./tube.module.css";

function reactionTotal(video: TubeVideo): number {
  return Object.values(video.reactions).reduce((sum, n) => sum + n, 0);
}

export default function VideoGrid() {
  const [query, setQuery] = useState("");
  const [videos, setVideos] = useState<TubeVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTubeVideos()
      .then(setVideos)
      .catch((caught: unknown) => setError(describeError(caught)));
  }, []);

  const all = videos ?? [];
  const visible = all.filter((video) =>
    matchesQuery(query, video.title, video.description, video.creator?.display_name ?? "CTRL+AI"),
  );

  return (
    <>
      <div className={`toolbar ${styles.toolbar}`}>
        <div className={styles.searchSlot}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="영상 제목, 설명, 만든 사람으로 검색"
            resultCount={visible.length}
            totalCount={all.length}
          />
        </div>
      </div>

      {error ? (
        <p className="small" role="alert">
          {error}
        </p>
      ) : videos === null ? (
        <p className="small muted">불러오는 중…</p>
      ) : visible.length === 0 ? (
        <div className={styles.searchEmpty}>
          <p>{all.length === 0 ? "아직 영상이 없어요." : "검색 결과가 없습니다. 다른 낱말로 찾아보세요."}</p>
          {all.length > 0 && (
            <button className="btn btn-sm" type="button" onClick={() => setQuery("")}>
              검색 조건 지우기
            </button>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((video) => (
            <Link
              className={styles.card}
              href={`/ctrlaitube/${video.slug}`}
              key={video.slug}
              data-testid={video.official ? "official-card" : "video-card"}
            >
              <div className={`${styles.thumbnail} ${styles.thumbnailTall}`}>
                {/* 세로 편의 포스터 — CtrlAITube는 어느 기기에서나 세로 편입니다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.poster} src={video.poster_mobile_src} alt="" />
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
                    <Heart size={12} aria-hidden="true" /> {reactionTotal(video)}
                  </span>
                  <span className={styles.metaItem}>
                    <MessageCircle size={12} aria-hidden="true" /> {video.comment_count}
                  </span>
                  <span className={`${styles.metaItem} ${styles.metaDate}`}>{exactDate(video.published_at)}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
