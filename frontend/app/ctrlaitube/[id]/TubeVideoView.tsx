"use client";

/**
 * 실제 영상의 재생 화면 (promo-videos) — 지금은 CTRL+AI 소개 영상 하나.
 *
 * 예시 영상의 화면(`page.tsx`)과 같은 두 칸 배치(`watch.module.css`)에
 * 넣되, 재생 틀에는 그림 대신 **진짜 영상**이 들어가고, 오른쪽 칸의
 * 반응과 댓글은 **저장됩니다** — 반응은 누를 때마다 서버에 켜고 끄고,
 * 댓글은 쓰고 고치고 지우고 신고합니다. 처리 뒤에는 서버에서 다시 읽어
 * 화면이 서버와 어긋나지 않게 합니다.
 *
 * 영상은 데스크탑에서 가로 파일, 휴대폰 너비에서 세로 파일을 틉니다
 * (`PromoVideo`). 재생 틀의 비율도 그에 맞춰 바뀝니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CommentSection, ReactionChips, type CommentThread } from "@/app/components/CommentSection";
import PromoVideo, { useDesktopWidth } from "@/app/components/PromoVideo";
import { useToast } from "@/app/components/ToastProvider";
import { describeError } from "@/lib/http";
import { MEMBERSHIP_LABEL, type Comment, type ReactionType } from "@/lib/mock-data";
import { MEMBERSHIP_BADGE } from "@/lib/quarters";
import { exactDate } from "@/lib/relative-time";
import {
  addTubeComment,
  deleteTubeComment,
  editTubeComment,
  formatDuration,
  getTubeVideo,
  reportTubeComment,
  toggleTubeReaction,
  type TubeComment,
  type TubeVideoDetail,
} from "@/lib/tube";

import styles from "./watch.module.css";

/** 서버의 댓글을 댓글칸이 아는 꼴로. id는 문자열, 공감은 아직 없음(0). */
function toComment(row: TubeComment): Comment {
  return {
    id: String(row.id),
    author: row.author
      ? { username: row.author.username, displayName: row.author.display_name, membership: row.author.membership }
      : { username: "", displayName: "탈퇴 회원", membership: "former" },
    body: row.body,
    createdAt: row.created_at,
    likes: 0,
    mine: row.mine,
    replies: row.replies.length > 0 ? row.replies.map(toComment) : undefined,
  };
}

export default function TubeVideoView({ slug }: { slug: string }) {
  const toast = useToast();
  const desktop = useDesktopWidth();
  const [video, setVideo] = useState<TubeVideoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      getTubeVideo(slug)
        .then((row) => {
          setVideo(row);
          setError(null);
        })
        .catch((caught: unknown) => setError(describeError(caught))),
    [slug],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 실패하면 토스트로 알리고 화면은 서버의 상태로 되돌립니다. */
  const attempt = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (caught) {
        toast.show(describeError(caught));
      } finally {
        await reload();
      }
    },
    [reload, toast],
  );

  if (error) {
    return (
      <div className={styles.frame}>
        <Link className={styles.back} href="/ctrlaitube">
          ← CtrlAITube
        </Link>
        <p className="small" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!video) {
    return (
      <div className={styles.frame}>
        <p className="small muted">불러오는 중…</p>
      </div>
    );
  }

  const comments = video.comments.map(toComment);
  const thread: CommentThread = {
    comments,
    count: video.comment_count,
    live: true,
    // 쓰기는 약속을 돌려줍니다: 댓글칸은 성공해야 입력칸을 비우고, 실패하면
    // 그 아래에 이유를 적습니다. 어느 쪽이든 서버의 상태를 다시 읽습니다.
    add: async (body) => {
      try {
        await addTubeComment(slug, body);
      } finally {
        await reload();
      }
    },
    addReply: async (parentId, body) => {
      try {
        await addTubeComment(slug, body, Number(parentId));
      } finally {
        await reload();
      }
    },
    edit: async (id, body) => {
      try {
        await editTubeComment(Number(id), body);
      } finally {
        await reload();
      }
    },
    remove: async (id) => {
      await deleteTubeComment(Number(id));
      await reload();
    },
    report: async (id, reason) => {
      const result = await reportTubeComment(Number(id), reason);
      toast.show(result.detail);
    },
  };

  const toggle = (type: ReactionType) => void attempt(() => toggleTubeReaction(slug, type));
  const creatorName = video.creator?.display_name ?? "CTRL+AI";

  return (
    <div className={styles.frame}>
      <div className={styles.layout}>
        <div className={styles.stage}>
          <Link className={styles.back} href="/ctrlaitube">
            ← CtrlAITube
          </Link>

          <div
            className={styles.playerFrame}
            style={{ "--player-ar": desktop ? "16 / 9" : "9 / 16" } as React.CSSProperties}
          >
            <PromoVideo
              className={styles.playerVideo}
              title={video.title}
              sources={{
                desktop: video.hosted_desktop_src,
                mobile: video.hosted_mobile_src,
                posterDesktop: video.poster_desktop_src,
                posterMobile: video.poster_mobile_src,
              }}
            />
          </div>

          <h1 className={styles.title}>
            {video.title} {video.official && <span className="badge badge-accent">공식</span>}
          </h1>

          <p className={styles.meta}>
            <span className={styles.metaCreator}>
              {creatorName}
              {video.creator && (
                <span className={`badge ${MEMBERSHIP_BADGE[video.creator.membership]}`}>
                  {MEMBERSHIP_LABEL[video.creator.membership]}
                </span>
              )}
            </span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{exactDate(video.published_at)}</span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{formatDuration(video.duration_seconds)}</span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{desktop ? "16:9 가로" : "9:16 세로"}</span>
          </p>

          <p className={styles.description}>{video.description}</p>
        </div>

        <aside className={styles.panel} aria-label="반응과 댓글">
          <ReactionChips reactions={video.reactions} pressed={video.my_reactions} onToggle={toggle} />
          <p className={styles.panelHeading}>댓글 {video.comment_count}</p>
          <CommentSection thread={thread} fill />
        </aside>
      </div>
    </div>
  );
}
