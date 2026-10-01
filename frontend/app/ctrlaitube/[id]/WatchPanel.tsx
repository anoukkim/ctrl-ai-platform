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
 * 아직 **목업입니다.** 여기서 쓴 댓글은 이 화면을 떠나면 사라집니다 —
 * 저장은 Phase 8에서 붙습니다. 그래도 입력칸을 막아 두지 않은 이유는,
 * 쓸 수 없는 입력칸으로는 Enter로 올라가는지, 줄바꿈이 되는지, 긴
 * 실타래가 칸을 넘지 않는지를 확인할 방법이 없기 때문입니다. 사라진다는
 * 사실은 입력칸 아래에 작게 적어 둡니다.
 *
 * 반응과 댓글을 `components/Community.tsx`의 것을 쓰지 않고 여기서 따로
 * 그리는 것도 일부러입니다. 그쪽은 CtrlAIApps가 함께 쓰는 읽기 전용
 * 표시이고, 이 화면만 누를 수 있는 칩과 답글·공감이 있는 댓글칸을
 * 요구합니다. CtrlAIApps가 같은 것을 필요로 하는 때(Phase 5)에 공용으로
 * 올리는 편이, 쓰이지도 않는 설정을 공용 컴포넌트에 미리 만드는 것보다
 * 낫습니다.
 */

import { CornerDownRight, Heart, Lightbulb, Sparkles, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import { useMyQuarter } from "@/app/components/MyQuarterProvider";
import {
  MEMBERSHIP_LABEL,
  REACTION_LABEL,
  totalComments,
  type Comment,
  type CommunityVideo,
  type Creator,
  type MembershipStatus,
  type ReactionType,
} from "@/lib/mock-data";
import { MEMBERSHIP_BADGE } from "@/lib/quarters";
import { exactDate, relativeTime } from "@/lib/relative-time";

import styles from "./watch.module.css";

/** 답글이 이 수를 넘으면 접습니다. 긴 실타래 하나가 댓글칸을 다 차지하지
 *  않도록 하기 위한 값입니다. */
const COLLAPSE_AFTER = 3;

const REACTION_ICON: Record<ReactionType, typeof Heart> = {
  like: Heart,
  useful: Lightbulb,
  interesting: Sparkles,
};

const REACTION_TYPES: ReactionType[] = ["like", "useful", "interesting"];

type Tab = "ctrlai" | "youtube";
type Sort = "newest" | "popular";

const SORT_LABEL: Record<Sort, string> = {
  newest: "최신순",
  popular: "인기순",
};

/* ------------------------------------------------------------------ */
/* 작은 조각들                                                          */
/* ------------------------------------------------------------------ */

/** 이름 첫 글자를 넣은 둥근 자리. 회원 사진은 아직 없습니다. */
function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`${styles.avatar} ${small ? styles.avatarSmall : ""}`} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

function AuthorLine({ author, createdAt }: { author: Creator; createdAt: string }) {
  return (
    <span className={styles.authorLine}>
      <span className={styles.authorName}>{author.displayName}</span>
      <span className={`badge ${MEMBERSHIP_BADGE[author.membership]}`}>
        {MEMBERSHIP_LABEL[author.membership]}
      </span>
      {/*
       * 보이는 것은 "2일 전", 가리키면 정확한 날짜. 짧게 읽히면서도 사실을
       * 잃지 않습니다.
       *
       * `suppressHydrationWarning`이 필요한 이유: 이 화면은 빌드할 때 미리
       * 그려집니다(generateStaticParams). 그때 박힌 "6일 전"은 한 달 뒤에
       * 열어 보는 사람의 시계로는 "1개월 전"이고, React는 서버가 그린 글자와
       * 브라우저가 그린 글자가 다르면 경고를 냅니다. 여기서는 **다른 것이
       * 맞습니다** — 지난 시간은 보는 순간마다 달라지니까요. 이 표시에
       * 한해서만 그 비교를 끕니다. 브라우저는 자기 시계로 다시 그립니다.
       */}
      <time
        className={styles.commentTime}
        dateTime={createdAt}
        title={exactDate(createdAt)}
        suppressHydrationWarning
      >
        {relativeTime(createdAt)}
      </time>
    </span>
  );
}

/**
 * 댓글을 쓰는 칸.
 *
 * Enter로 올리고 Shift+Enter로 줄을 바꿉니다. 글이 길어지면 칸이 같이
 * 자랍니다 — 한 줄 입력칸에서는 두 줄 넘는 댓글을 쓸 때 앞부분이 보이지
 * 않습니다.
 */
function Composer({
  value,
  onChange,
  onSubmit,
  onCancel,
  authorName,
  placeholder,
  small = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  authorName: string;
  placeholder: string;
  small?: boolean;
  autoFocus?: boolean;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = value.trim().length === 0;

  // 입력한 내용의 높이에 맞춰 칸을 늘립니다. 먼저 auto로 되돌리는 것은
  // 글을 지웠을 때 칸이 줄어들게 하기 위해서입니다.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글은 조합 중에도 Enter가 들어옵니다. 조합이 끝나지 않은 상태에서
    // 올려 버리면 마지막 글자가 잘리므로 그때는 넘깁니다.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!empty) onSubmit();
  }

  return (
    <div className={`${styles.composer} ${small ? styles.composerSmall : ""}`}>
      <Avatar name={authorName} small={small} />
      <div className={styles.composerBody}>
        <textarea
          ref={field}
          className={styles.composerField}
          value={value}
          placeholder={placeholder}
          rows={1}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={placeholder}
        />
        <div className={styles.composerRow}>
          <span className={styles.composerHint}>Enter 등록 · Shift+Enter 줄바꿈</span>
          <span className={styles.composerButtons}>
            {onCancel && (
              <button className="btn btn-sm" type="button" onClick={onCancel}>
                취소
              </button>
            )}
            <button
              className="btn btn-sm btn-primary"
              type="button"
              onClick={onSubmit}
              disabled={empty}
            >
              등록
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 댓글 한 개                                                           */
/* ------------------------------------------------------------------ */

interface CommentProps {
  comment: Comment;
  isReply?: boolean;
  /**
   * 이 댓글이 속한 실타래의 맨 윗 댓글 id.
   *
   * 답글에 답글을 달아도 한 단계 아래에만 쌓입니다. 끝없이 들여쓰면 몇
   * 번 주고받은 뒤에는 글이 한 줄에 두 글자씩 보입니다. 30% 폭의 칸에서는
   * 더 빨리 그렇게 됩니다.
   */
  threadId?: string;
  likeCount: (comment: Comment) => number;
  isLiked: (id: string) => boolean;
  onToggleLike: (id: string) => void;
  replyTo: string | null;
  onOpenReply: (id: string | null) => void;
  onReply: (parentId: string, body: string) => void;
  openThreads: string[];
  onToggleThread: (id: string) => void;
  authorName: string;
}

function CommentItem(props: CommentProps) {
  const { comment, isReply = false, likeCount, isLiked, onToggleLike, replyTo } = props;
  const [draft, setDraft] = useState("");

  const replies = comment.replies ?? [];
  const threadOpen = props.openThreads.includes(comment.id);
  const collapsed = replies.length > COLLAPSE_AFTER && !threadOpen;
  const liked = isLiked(comment.id);

  function submitReply() {
    if (draft.trim().length === 0) return;
    props.onReply(props.threadId ?? comment.id, draft.trim());
    setDraft("");
  }

  return (
    <article className={isReply ? styles.reply : styles.comment}>
      <Avatar name={comment.author.displayName} small={isReply} />

      <div className={styles.commentBody}>
        <AuthorLine author={comment.author} createdAt={comment.createdAt} />
        <p className={styles.commentText}>{comment.body}</p>

        <div className={styles.commentActions}>
          <button
            className={`${styles.commentAction} ${liked ? styles.commentActionOn : ""}`}
            type="button"
            onClick={() => onToggleLike(comment.id)}
            aria-pressed={liked}
            aria-label={`공감 ${likeCount(comment)}`}
          >
            <ThumbsUp size={13} aria-hidden="true" />
            {likeCount(comment)}
          </button>
          <button
            className={styles.commentAction}
            type="button"
            onClick={() => props.onOpenReply(replyTo === comment.id ? null : comment.id)}
            aria-expanded={replyTo === comment.id}
          >
            <CornerDownRight size={13} aria-hidden="true" />
            답글
          </button>
        </div>

        {replyTo === comment.id && (
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={submitReply}
            onCancel={() => {
              setDraft("");
              props.onOpenReply(null);
            }}
            authorName={props.authorName}
            placeholder={`${comment.author.displayName}님에게 답글 쓰기`}
            small
            autoFocus
          />
        )}

        {replies.length > 0 && (
          <div className={styles.replies}>
            {collapsed ? (
              <button
                className={styles.threadToggle}
                type="button"
                onClick={() => props.onToggleThread(comment.id)}
              >
                답글 {replies.length}개 보기
              </button>
            ) : (
              <>
                {replies.map((reply) => (
                  <CommentItem
                    {...props}
                    comment={reply}
                    isReply
                    threadId={comment.id}
                    key={reply.id}
                  />
                ))}
                {replies.length > COLLAPSE_AFTER && (
                  <button
                    className={styles.threadToggle}
                    type="button"
                    onClick={() => props.onToggleThread(comment.id)}
                  >
                    답글 숨기기
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 칸 전체                                                              */
/* ------------------------------------------------------------------ */

export default function WatchPanel({ video }: { video: CommunityVideo }) {
  const [tab, setTab] = useState<Tab>("ctrlai");
  const [sort, setSort] = useState<Sort>("newest");
  const [comments, setComments] = useState<Comment[]>(video.comments);
  const [reacted, setReacted] = useState<ReactionType[]>([]);
  const [likedComments, setLikedComments] = useState<string[]>([]);
  const [openThreads, setOpenThreads] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // 새 댓글의 id. 저장되지 않는 값이므로 순번으로 충분합니다.
  const nextId = useRef(0);

  const me = useMe();

  function toggleReaction(type: ReactionType) {
    setReacted((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  function reactionCount(type: ReactionType): number {
    return video.reactions[type] + (reacted.includes(type) ? 1 : 0);
  }

  function likeCount(comment: Comment): number {
    return comment.likes + (likedComments.includes(comment.id) ? 1 : 0);
  }

  function toggleCommentLike(id: string) {
    setLikedComments((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  }

  function toggleThread(id: string) {
    setOpenThreads((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    );
  }

  function makeComment(body: string): Comment {
    nextId.current += 1;
    return {
      id: `new-${nextId.current}`,
      author: me,
      body,
      // 방금 쓴 댓글은 "방금 전"으로 읽혀야 하므로 시각까지 적습니다.
      createdAt: new Date().toISOString(),
      likes: 0,
    };
  }

  function postComment() {
    const body = draft.trim();
    if (body.length === 0) return;
    setComments((current) => [...current, makeComment(body)]);
    setDraft("");
    // 새 댓글이 바로 보이도록 최신순으로 되돌립니다. 인기순으로 보던
    // 중이라면 방금 쓴 글이 맨 아래에 묻혀 사라진 것처럼 보입니다.
    setSort("newest");
  }

  function postReply(parentId: string, body: string) {
    const reply = makeComment(body);
    setComments((current) => addReply(current, parentId, reply));
    // 답글을 달면 그 실타래는 펼쳐 둡니다.
    setOpenThreads((current) => (current.includes(parentId) ? current : [...current, parentId]));
    setReplyTo(null);
  }

  const ordered = [...comments].sort((a, b) =>
    sort === "popular" ? likeCount(b) - likeCount(a) : b.createdAt.localeCompare(a.createdAt),
  );

  const ctrlaiCount = totalComments(comments);

  return (
    <aside className={styles.panel} aria-label="반응과 댓글">
      <div className={styles.reactionRow}>
        {REACTION_TYPES.map((type) => {
          const Icon = REACTION_ICON[type];
          const on = reacted.includes(type);
          return (
            <button
              className={`${styles.reactionChip} ${on ? styles.reactionChipOn : ""}`}
              key={type}
              type="button"
              onClick={() => toggleReaction(type)}
              aria-pressed={on}
            >
              <Icon size={14} aria-hidden="true" />
              {REACTION_LABEL[type]}
              <span className={styles.reactionCount}>{reactionCount(type)}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.tabs} role="tablist" aria-label="댓글 종류">
        <button
          className={`${styles.tab} ${tab === "ctrlai" ? styles.tabOn : ""}`}
          type="button"
          role="tab"
          aria-selected={tab === "ctrlai"}
          onClick={() => setTab("ctrlai")}
        >
          CTRL+AI 댓글 {ctrlaiCount}
        </button>
        <button
          className={`${styles.tab} ${tab === "youtube" ? styles.tabOn : ""}`}
          type="button"
          role="tab"
          aria-selected={tab === "youtube"}
          onClick={() => setTab("youtube")}
        >
          YouTube 댓글 {video.youtubeCommentCount}
        </button>
      </div>

      {tab === "ctrlai" ? (
        <>
          <div className={styles.sortRow}>
            <span className={styles.sortLabel}>정렬</span>
            {(["newest", "popular"] as Sort[]).map((value) => (
              <button
                className={`${styles.sortButton} ${sort === value ? styles.sortButtonOn : ""}`}
                key={value}
                type="button"
                onClick={() => setSort(value)}
                aria-pressed={sort === value}
              >
                {SORT_LABEL[value]}
              </button>
            ))}
          </div>

          <div className={styles.commentScroll}>
            {ordered.length === 0 ? (
              <p className={styles.commentEmpty}>아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</p>
            ) : (
              ordered.map((comment) => (
                <CommentItem
                  comment={comment}
                  key={comment.id}
                  likeCount={likeCount}
                  isLiked={(id) => likedComments.includes(id)}
                  onToggleLike={toggleCommentLike}
                  replyTo={replyTo}
                  onOpenReply={setReplyTo}
                  onReply={postReply}
                  openThreads={openThreads}
                  onToggleThread={toggleThread}
                  authorName={me.displayName}
                />
              ))
            )}
          </div>

          <div className={styles.panelFoot}>
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={postComment}
              authorName={me.displayName}
              placeholder="댓글을 남겨보세요"
            />
            <p className={styles.mockNote}>
              댓글 기능은 아직 준비 중입니다. 지금 쓴 댓글은 저장되지 않습니다.
            </p>
          </div>
        </>
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

/* ------------------------------------------------------------------ */
/* 거드는 함수들                                                        */
/* ------------------------------------------------------------------ */

/** 답글을 해당 댓글 아래에 넣은 새 목록을 돌려줍니다.
 *
 *  원본을 고치지 않고 새로 만듭니다 — React는 바뀐 것을 참조로 알아보므로,
 *  배열 안을 직접 고치면 화면이 다시 그려지지 않습니다. */
function addReply(comments: Comment[], parentId: string, reply: Comment): Comment[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return { ...comment, replies: [...(comment.replies ?? []), reply] };
    }
    if (comment.replies) {
      return { ...comment, replies: addReply(comment.replies, parentId, reply) };
    }
    return comment;
  });
}

/**
 * 댓글을 쓰는 사람 — 지금 로그인한 회원.
 *
 * 이름은 계정에서, 회원 상태는 이번 분기 참여 기록에서 옵니다. 참여
 * 기록이 없으면 "이번 분기에 참여하지 않음"이므로 비활동으로 봅니다.
 * 꼬리표는 사실을 보여 주는 자리라 모를 때 활동 회원으로 적지 않습니다.
 */
function useMe(): Creator {
  const { state: userState } = useCurrentUser();
  const { state: quarterState } = useMyQuarter();

  const membership: MembershipStatus =
    quarterState.phase === "ready"
      ? (quarterState.quarter.membership_status ?? "inactive")
      : "inactive";

  if (userState.phase !== "authenticated") {
    return { username: "", displayName: "나", membership };
  }

  return {
    username: userState.user.username,
    displayName: userState.user.display_name,
    membership,
  };
}
