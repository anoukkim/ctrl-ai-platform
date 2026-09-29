/**
 * CtrlAITube — 커뮤니티 영상 피드.
 *
 * Ctrl AI는 영상을 직접 보관하지 않습니다. 게시된 영상은 만든 사람의
 * YouTube 채널에 올라가 있고, 여기에서는 YouTube 영상 ID로 불러와 보여 줍니다.
 *
 * 아래 썸네일은 이미지를 내려받지 않고 CSS로 그립니다. 그래서 외부 연결
 * 없이도 화면이 정상적으로 보입니다.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { CreatorLine } from "@/app/components/Community";
import { MOCK_VIDEOS, totalReactions } from "@/lib/mock-data";

import styles from "./tube.module.css";

export const metadata: Metadata = {
  title: "CtrlAITube — Ctrl AI",
};

export default function CtrlAITubePage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          CtrlAITube <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          회원들이 만들어 자기 YouTube 채널에 올린 영상입니다. 여기에서 나누는 이야기는
          Ctrl AI 안에만 쌓입니다.
        </p>
        <span className="badge badge-muted">{MOCK_VIDEOS.length}개</span>
      </header>

      <div className={styles.grid}>
        {MOCK_VIDEOS.map((video) => (
          <Link className={styles.card} href={`/ctrlaitube/${video.id}`} key={video.id}>
            <div
              className={styles.thumbnail}
              style={{
                background: `linear-gradient(140deg, ${video.artwork[0]}, ${video.artwork[1]})`,
              }}
            >
              <span className={styles.playGlyph} aria-hidden="true">
                ▶
              </span>
              <span className={styles.duration}>{video.duration}</span>
            </div>
            <div className={styles.cardBody}>
              <h2 className={styles.title}>{video.title}</h2>
              <CreatorLine creator={video.creator} />
              <p className={styles.meta}>
                <span>♥ {totalReactions(video.reactions)}</span>
                <span>💬 {video.comments.length}</span>
                <span>{video.publishedAt}</span>
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
