/**
 * CtrlAIStore와 CtrlAITube가 함께 쓰는 커뮤니티 요소:
 * 만든 사람 표시, 반응, 댓글과 답글.
 *
 * 모두 Server Component이며 아직 동작하지 않습니다. 반응과 댓글은
 * 앱은 Phase 5, 영상은 Phase 8에서 CTRL+AI의 PostgreSQL에 저장됩니다.
 */

import {
  MEMBERSHIP_LABEL,
  REACTION_LABEL,
  type Comment,
  type Creator,
  type ReactionType,
} from "@/lib/mock-data";

import styles from "./community.module.css";

const MEMBERSHIP_BADGE: Record<Creator["membership"], string> = {
  active: "badge-ok",
  inactive: "badge-warn",
  former: "badge-muted",
};

/**
 * 만든 사람을 표시합니다.
 *
 * 커뮤니티를 떠나도 이름은 지우지 않습니다. 탈퇴 회원이 게시한 작품에도
 * 만든 사람의 이름이 그대로 남습니다.
 */
export function CreatorLine({ creator, prefix = "만든 사람" }: { creator: Creator; prefix?: string }) {
  return (
    <span className={styles.creator}>
      <span className="muted">{prefix}</span>
      <span className={styles.creatorName}>{creator.displayName}</span>
      <span className={`badge ${MEMBERSHIP_BADGE[creator.membership]}`}>
        {MEMBERSHIP_LABEL[creator.membership]}
      </span>
    </span>
  );
}

export function Reactions({ reactions }: { reactions: Record<ReactionType, number> }) {
  const types: ReactionType[] = ["like", "useful", "interesting"];

  return (
    <div className={styles.reactions}>
      {types.map((type) => (
        <button
          className={styles.reaction}
          key={type}
          type="button"
          disabled
          title="반응은 CTRL+AI에 저장됩니다. 다음 단계에서 제공됩니다."
        >
          {REACTION_LABEL[type]}
          <span className={styles.reactionCount}>{reactions[type]}</span>
        </button>
      ))}
    </div>
  );
}

function CommentCard({ comment, isReply = false }: { comment: Comment; isReply?: boolean }) {
  return (
    <article className={isReply ? styles.reply : styles.comment}>
      <div className={styles.commentHead}>
        <CreatorLine creator={comment.author} prefix="" />
        <span className={styles.commentDate}>{comment.createdAt}</span>
      </div>
      <p className={styles.commentBody}>{comment.body}</p>

      {comment.replies && comment.replies.length > 0 && (
        <div className={styles.replies}>
          {comment.replies.map((reply) => (
            <CommentCard comment={reply} isReply key={reply.id} />
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * CTRL+AI 안에서 이루어지는 대화입니다.
 *
 * 영상의 경우 만든 사람의 YouTube 댓글과 일부러 분리해 둡니다. 그래야
 * 커뮤니티의 이야기가 채널과 상관없이 이어질 수 있습니다.
 */
export function CommentThread({ comments }: { comments: Comment[] }) {
  return (
    <>
      {comments.length > 0 ? (
        <div className={styles.comments}>
          {comments.map((comment) => (
            <CommentCard comment={comment} key={comment.id} />
          ))}
        </div>
      ) : (
        <p className={styles.commentEmpty}>아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</p>
      )}

      <div className={styles.commentComposer}>
        <input
          className="field"
          type="text"
          placeholder="댓글을 남겨보세요"
          disabled
          aria-label="댓글 작성 (Phase 0에서는 사용할 수 없습니다)"
        />
        <div className={styles.composerRow}>
          <span className="small muted">댓글 기능은 아직 준비 중입니다.</span>
          <button className="btn" type="button" disabled>
            등록
          </button>
        </div>
      </div>
    </>
  );
}
