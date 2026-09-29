/**
 * CtrlAITube 영상 상세 화면.
 *
 * 댓글 영역이 두 개로 나뉘어 있는 점에 주의하세요.
 *   1. Ctrl AI 댓글 — Ctrl AI의 PostgreSQL에 저장됩니다.
 *   2. YouTube 댓글 — 만든 사람의 채널에 속합니다.
 *
 * 두 가지를 섞지 않습니다. 그래야 커뮤니티의 이야기가 채널과 상관없이
 * 이어질 수 있습니다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentThread, CreatorLine, Reactions } from "@/app/components/Community";
import { MEMBERSHIP_DESCRIPTION, MOCK_VIDEOS, findVideo } from "@/lib/mock-data";

import styles from "../tube.module.css";

interface VideoDetailProps {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return MOCK_VIDEOS.map((video) => ({ id: video.id }));
}

export async function generateMetadata({ params }: VideoDetailProps): Promise<Metadata> {
  const { id } = await params;
  const video = findVideo(id);

  return { title: video ? `${video.title} — CtrlAITube` : "영상을 찾을 수 없습니다 — Ctrl AI" };
}

export default async function VideoDetailPage({ params }: VideoDetailProps) {
  const { id } = await params;
  const video = findVideo(id);

  if (!video) notFound();

  return (
    <>
      <Link className={styles.back} href="/ctrlaitube">
        ← CtrlAITube
      </Link>

      <div
        className={styles.player}
        style={{ background: `linear-gradient(140deg, ${video.artwork[0]}, ${video.artwork[1]})` }}
      >
        <div className={styles.playerInner}>
          <strong>{video.title}</strong>
          <p className={styles.playerNote}>
            영상이 만든 사람의 채널에 올라가면 이 자리에서 바로 재생할 수 있습니다.
          </p>
        </div>
      </div>

      <h1 className="page-title">
        {video.title} <span className="badge badge-mock">준비 중</span>
      </h1>
      <p className="page-subtitle">{video.description}</p>

      <div className={styles.detailRows}>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>만든 사람</span>
          <CreatorLine creator={video.creator} prefix="" />
        </p>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>회원 상태</span>
          <span className="small muted">{MEMBERSHIP_DESCRIPTION[video.creator.membership]}</span>
        </p>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>게시일</span>
          <span>{video.publishedAt}</span>
        </p>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>길이</span>
          <span>{video.duration}</span>
        </p>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>생성</span>
          <span>Higgsfield</span>
        </p>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>YouTube 영상 ID</span>
          <span>{video.youtubeVideoId ?? "아직 게시하지 않았습니다"}</span>
        </p>
      </div>

      <h2 className="section-title">사용한 프롬프트</h2>
      <p className={styles.prompt}>{video.prompt}</p>

      <div className={styles.sections}>
        <section>
          <h2 className="section-title">반응</h2>
          <Reactions reactions={video.reactions} />
        </section>

        <section>
          <h2 className="section-title">Ctrl AI 댓글 {video.comments.length}개</h2>
          <p className="small muted" style={{ marginBottom: "0.75rem" }}>
            이 대화는 Ctrl AI에 저장되며 회원들에게만 보입니다.
          </p>
          <CommentThread comments={video.comments} />
        </section>

        <section className={styles.youtubeSection}>
          <h2 className="section-title">YouTube 댓글</h2>
          <p className={styles.youtubeNote}>
            {video.youtubeCommentCount > 0
              ? `만든 사람의 YouTube 채널에 댓글 ${video.youtubeCommentCount}개가 있습니다.`
              : "만든 사람의 YouTube 채널에는 아직 댓글이 없습니다."}{" "}
            이 댓글은 YouTube에 속하며, Ctrl AI 댓글과 섞이지 않도록 따로 보여 드립니다.
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            <button className="btn" type="button" disabled title="Phase 7에서 제공됩니다">
              YouTube에서 보기
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
