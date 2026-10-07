/**
 * CtrlAITube 영상 재생 화면.
 *
 * 두 칸입니다. 왼쪽(70%)에 영상과 그 영상에 대한 사실, 오른쪽(30%)에
 * 반응과 댓글. 예전에는 한 칸에 모두 세로로 쌓여 있었고, 영상이 폭을
 * 가득 채우는 바람에 100% 배율에서 제목부터 아래가 화면 밖으로 밀려
 * 났습니다. 영상을 보면서 이야기를 읽을 수 없는 배치였습니다.
 *
 * 비율이 다른 영상도 같은 배치로 봅니다 — 세로 영상이라고 칸을 바꾸지
 * 않습니다. 대신 재생 틀의 높이를 화면 높이의 75%로 묶고, 남는 자리는
 * 어둡게 둡니다(레터박스). 그래야 9:16 영상에서도 제목이 스크롤 없이
 * 보입니다. 자세한 계산은 `watch.module.css`의 `.playerFrame`에 있습니다.
 *
 * 영상에 대한 사실 중 자주 보지 않는 것(YouTube 영상 ID, 회원 상태 설명)은
 * "자세히" 안으로 넣었습니다. 예전의 큰 표는 여섯 줄 모두 같은 무게로
 * 보여서, 정작 먼저 읽어야 할 제목과 만든 사람이 묻혔습니다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ASPECT_LABEL, ASPECT_RATIO_CSS } from "@/lib/aspect";
import {
  MEMBERSHIP_DESCRIPTION,
  MEMBERSHIP_LABEL,
  MOCK_VIDEOS,
  findVideo,
  formatDate,
} from "@/lib/mock-data";
import { MEMBERSHIP_BADGE } from "@/lib/quarters";

import WatchPanel from "./WatchPanel";
import { softTint } from "@/app/ctrlaistore/softTint";

import styles from "./watch.module.css";

/** 영상을 만든 도구. 지금은 Higgsfield 한 곳입니다 — 제공자가 여러
 *  곳이 되면 영상 기록이 자기가 어디서 만들어졌는지 들고 다닙니다. */
const GENERATED_WITH = "Higgsfield";

interface VideoDetailProps {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return MOCK_VIDEOS.map((video) => ({ id: video.id }));
}

export async function generateMetadata({ params }: VideoDetailProps): Promise<Metadata> {
  const { id } = await params;
  const video = findVideo(id);

  return {
    title: video ? `${video.title} — CtrlAITube` : "영상을 찾을 수 없습니다 — CTRL+AI",
  };
}

export default async function VideoDetailPage({ params }: VideoDetailProps) {
  const { id } = await params;
  const video = findVideo(id);

  if (!video) notFound();

  return (
    <div className={styles.frame}>
      <div className={styles.layout}>
        <div className={styles.stage}>
          <Link className={styles.back} href="/ctrlaitube">
            ← CtrlAITube
          </Link>

          {/* 재생 틀. 비율을 CSS 변수로 넘기면 틀의 높이와 영상의 너비가
              그 값 하나로 정해집니다. */}
          <div
            className={styles.playerFrame}
            style={
              {
                "--player-ar": ASPECT_RATIO_CSS[video.aspectRatio],
              } as React.CSSProperties
            }
          >
            <div
              className={styles.player}
              style={{ background: softTint(video.artwork) }}
            >
              <div className={styles.playerInner}>
                <strong>{video.title}</strong>
                <p className={styles.playerNote}>
                  영상이 만든 사람의 채널에 올라가면 이 자리에서 바로 재생할 수 있습니다.
                </p>
              </div>
            </div>
          </div>

          <h1 className={styles.title}>
            {video.title} <span className="badge badge-mock">준비 중</span>
          </h1>

          {/* 제목 아래 한 줄. 가장 자주 보는 사실만 모았습니다. */}
          <p className={styles.meta}>
            <span className={styles.metaCreator}>
              {video.creator.displayName}
              <span className={`badge ${MEMBERSHIP_BADGE[video.creator.membership]}`}>
                {MEMBERSHIP_LABEL[video.creator.membership]}
              </span>
            </span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{formatDate(video.publishedAt)}</span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{video.duration}</span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{ASPECT_LABEL[video.aspectRatio]}</span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{GENERATED_WITH}</span>
          </p>

          <p className={styles.description}>{video.description}</p>

          <h2 className="section-title">사용한 프롬프트</h2>
          <p className={styles.prompt}>{video.prompt}</p>
        </div>

        <WatchPanel video={video} />

        {/*
         * "자세히"는 일부러 댓글칸보다 **뒤에** 둡니다.
         *
         * 넓은 화면에서는 격자가 이것을 왼쪽 아래 칸에 놓지만, 좁은 화면에서는
         * 적힌 순서대로 쌓입니다 — 영상 · 제목 · 반응 · 댓글 · 자세히. 좁은
         * 화면에서 자세히가 댓글 위에 있으면, 거의 보지 않는 줄 몇 개가
         * 이야기를 아래로 밀어냅니다.
         */}
        <div className={styles.extra}>
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>자세히</summary>
            <div className={styles.detailsBody}>
              <p className={styles.detailRow}>
                <span className={styles.detailLabel}>YouTube 영상 ID</span>
                <span>{video.youtubeVideoId ?? "아직 게시하지 않았습니다"}</span>
              </p>
              <p className={styles.detailRow}>
                <span className={styles.detailLabel}>생성 도구</span>
                <span>{GENERATED_WITH}</span>
              </p>
              <p className={styles.detailRow}>
                <span className={styles.detailLabel}>회원 상태</span>
                <span className="small muted">
                  {MEMBERSHIP_DESCRIPTION[video.creator.membership]}
                </span>
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
