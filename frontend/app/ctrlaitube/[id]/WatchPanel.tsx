"use client";

/**
 * 재생 화면 오른쪽 칸 — 반응과 댓글.
 *
 * 위에서 아래로 반응 → 탭 → 댓글 → 입력칸입니다. 반응이 맨 위인 것은
 * 영상을 보고 바로 누르는 것이기 때문이고, 탭이 댓글 바로 위에 있는 것은
 * 탭이 바꾸는 것이 댓글 목록뿐이기 때문입니다.
 *
 * **CTRL+AI 댓글과 YouTube 댓글은 섞지 않습니다.** 둘을 탭으로 갈라 둔
 * 이유는 저장되는 곳이 다르기 때문입니다. CTRL+AI 댓글은 CTRL+AI에
 * 저장되어 회원들만 보고, YouTube 댓글은 만든 사람의 채널에 속합니다.
 * 한 목록에 섞으면 커뮤니티의 이야기가 채널에 딸린 것처럼 보입니다.
 *
 * 반응 칩·탭·댓글칸 자체는 `components/CommentSection.tsx`에 있습니다.
 * 처음에는 이 파일 안에 있었지만, CtrlAIApps의 앱 상세가 같은 댓글칸을
 * 쓰게 되면서 공용으로 올렸습니다 — 두 벌로 두면 한쪽만 고쳐집니다.
 * 이 파일에 남은 것은 **이 화면만의 것**뿐입니다: 패널의 틀, 두 가지
 * 댓글을 가르는 탭, 그리고 YouTube 쪽 설명.
 */

import { useState } from "react";

import {
  CommentSection,
  ReactionChips,
  TabBar,
  useCommentThread,
} from "@/app/components/CommentSection";
import { type CommunityVideo } from "@/lib/mock-data";

import styles from "./watch.module.css";

type Tab = "ctrlai" | "youtube";

export default function WatchPanel({ video }: { video: CommunityVideo }) {
  const [tab, setTab] = useState<Tab>("ctrlai");
  const thread = useCommentThread(video.comments);

  return (
    <aside className={styles.panel} aria-label="반응과 댓글">
      <ReactionChips reactions={video.reactions} />

      <TabBar
        label="댓글 종류"
        current={tab}
        onChange={(key) => setTab(key as Tab)}
        stretch
        tabs={[
          { key: "ctrlai", name: `CTRL+AI 댓글 ${thread.count}` },
          { key: "youtube", name: `YouTube 댓글 ${video.youtubeCommentCount}` },
        ]}
      />

      {tab === "ctrlai" ? (
        <CommentSection thread={thread} fill />
      ) : (
        <div className={styles.youtubePane}>
          <p className={styles.youtubeNote}>
            {video.youtubeCommentCount > 0
              ? `만든 사람의 YouTube 채널에 댓글 ${video.youtubeCommentCount}개가 있습니다.`
              : "만든 사람의 YouTube 채널에는 아직 댓글이 없습니다."}{" "}
            이 댓글은 YouTube에 속하며, CTRL+AI 댓글과 섞이지 않도록 따로 보여 드립니다.
          </p>
          <button className="btn btn-sm" type="button" disabled title="Phase 7에서 제공됩니다">
            YouTube에서 보기
          </button>
        </div>
      )}
    </aside>
  );
}
