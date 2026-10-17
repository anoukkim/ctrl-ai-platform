"use client";

/**
 * 앱의 반응과 댓글 (ctrlaiapps-reactions) — CtrlAITube의 오른쪽 칸과 같은 모양.
 *
 * 좋아요 · 유용해요 · 흥미로워요는 누를 때마다 켜고 끄고, 댓글은 쓰고 답하고
 * 고치고 지우고 신고합니다. 처리 뒤에는 서버에서 다시 읽어 화면이 서버와
 * 어긋나지 않게 해요. 참여하지 않는 분기에는 읽기만 돼요(서버가 막아요).
 */

import { useCallback, useEffect, useState } from "react";

import { CommentSection, ReactionChips, type CommentThread } from "@/app/components/CommentSection";
import { useToast } from "@/app/components/ToastProvider";
import {
  addAppComment,
  deleteAppComment,
  editAppComment,
  getAppDiscussion,
  reportAppComment,
  toggleAppReaction,
  type AppDiscussion,
} from "@/lib/apps";
import { describeError } from "@/lib/http";
import type { Comment, ReactionType } from "@/lib/mock-data";
import type { TubeComment } from "@/lib/tube";

import styles from "../ctrlaistore.module.css";

/** 서버의 댓글을 댓글칸이 아는 꼴로 (CtrlAITube와 같은 변환). */
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

export default function AppDiscussionPanel({ slug }: { slug: string }) {
  const toast = useToast();
  const [data, setData] = useState<AppDiscussion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      getAppDiscussion(slug)
        .then((row) => {
          setData(row);
          setError(null);
        })
        .catch((caught: unknown) => setError(describeError(caught))),
    [slug],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) {
    return (
      <p className="small muted" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p className="small muted">불러오는 중…</p>;

  const thread: CommentThread = {
    comments: data.comments.map(toComment),
    count: data.comment_count,
    live: true,
    add: async (body) => {
      try {
        await addAppComment(slug, body);
      } finally {
        await reload();
      }
    },
    addReply: async (parentId, body) => {
      try {
        await addAppComment(slug, body, Number(parentId));
      } finally {
        await reload();
      }
    },
    edit: async (id, body) => {
      try {
        await editAppComment(Number(id), body);
      } finally {
        await reload();
      }
    },
    remove: async (id) => {
      await deleteAppComment(Number(id));
      await reload();
    },
    report: async (id, reason) => {
      const result = await reportAppComment(Number(id), reason);
      toast.show(result.detail);
    },
  };

  const toggle = (type: ReactionType) => {
    void toggleAppReaction(slug, type)
      .then(setData)
      .catch((caught: unknown) => {
        toast.show(describeError(caught));
        void reload();
      });
  };

  return (
    <>
      <ReactionChips reactions={data.reactions} pressed={data.my_reactions} onToggle={toggle} />
      <p className={styles.panelHeading}>댓글 {data.comment_count}</p>
      <CommentSection thread={thread} fill />
    </>
  );
}
