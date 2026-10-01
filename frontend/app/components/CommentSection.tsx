"use client";

/**
 * 커뮤니티 댓글칸 — CtrlAITube 재생 화면과 CtrlAIApps 앱 상세가 함께 씁니다.
 *
 * 처음 만든 자리는 재생 화면의 `WatchPanel.tsx` 안이었고, 그때는 한
 * 화면만 쓰는 것이었으므로 그래도 됐습니다. 앱 상세가 같은 댓글칸을
 * 요구하면서 이리로 올렸습니다 — 두 벌로 두면 한쪽만 고쳐지고, 같은
 * 커뮤니티의 두 화면이 서로 다르게 움직입니다.
 *
 * 여기 있는 것:
 *   - `ReactionChips`    — 눌러서 켜고 끄는 반응 칩
 *   - `TabBar`           — 탭 한 줄 (재생 화면은 댓글 종류, 앱 상세는 내용)
 *   - `CommentSection`   — 정렬 · 댓글 목록 · 답글 · 입력칸
 *   - `useCommentThread` — 댓글 목록을 들고 있는 상태
 *
 * 상태를 컴포넌트 안에 숨기지 않고 훅으로 내놓은 이유는 **탭 이름**입니다.
 * "댓글 7"의 7은 탭이 그려야 하고, 댓글이 하나 올라가면 같이 늘어야
 * 합니다. 목록을 댓글칸이 혼자 들고 있으면 탭은 그 수를 알 길이 없어,
 * 방금 쓴 댓글이 목록에는 보이는데 탭에는 세어지지 않습니다.
 *
 * 아직 **목업입니다.** 여기서 쓴 댓글은 화면을 떠나면 사라집니다 — 앱은
 * Phase 5, 영상은 Phase 8에서 CTRL+AI의 PostgreSQL에 저장됩니다. 그래도
 * 입력칸을 막아 두지 않은 이유는, 쓸 수 없는 입력칸으로는 Enter로
 * 올라가는지, 줄바꿈이 되는지, 긴 실타래가 칸을 넘지 않는지를 확인할
 * 방법이 없기 때문입니다. 사라진다는 사실은 입력칸 아래에 작게 적어
 * 둡니다.
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
  type Creator,
  type MembershipStatus,
  type ReactionType,
} from "@/lib/mock-data";
import { MEMBERSHIP_BADGE } from "@/lib/quarters";
import { exactDate, relativeTime } from "@/lib/relative-time";

import styles from "./comment-section.module.css";

/** 답글이 이 수를 넘으면 접습니다. 긴 실타래 하나가 댓글칸을 다 차지하지
 *  않도록 하기 위한 값입니다. */
const COLLAPSE_AFTER = 3;

const REACTION_ICON: Record<ReactionType, typeof Heart> = {
  like: Heart,
  useful: Lightbulb,
  interesting: Sparkles,
};

const REACTION_TYPES: ReactionType[] = ["like", "useful", "interesting"];

type Sort = "newest" | "popular";

const SORT_LABEL: Record<Sort, string> = {
  newest: "최신순",
  popular: "인기순",
};

/* ------------------------------------------------------------------ */
/* 반응                                                                */
/* ------------------------------------------------------------------ */

/**
 * 반응 칩 한 줄.
 *
 * 누른 상태는 이 컴포넌트가 혼자 들고 있습니다 — 바깥에서 쓸 일이 없는
 * 값이고, 저장은 Phase 5와 8에서 붙습니다.
 */
export function ReactionChips({ reactions }: { reactions: Record<ReactionType, number> }) {
  const [reacted, setReacted] = useState<ReactionType[]>([]);

  function toggle(type: ReactionType) {
    setReacted((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  return (
    <div className={styles.reactionRow}>
      {REACTION_TYPES.map((type) => {
        const Icon = REACTION_ICON[type];
        const on = reacted.includes(type);
        return (
          <button
            className={`${styles.reactionChip} ${on ? styles.reactionChipOn : ""}`}
            key={type}
            type="button"
            onClick={() => toggle(type)}
            aria-pressed={on}
          >
            <Icon size={14} aria-hidden="true" />
            {REACTION_LABEL[type]}
            <span className={styles.reactionCount}>{reactions[type] + (on ? 1 : 0)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 탭                                                                  */
/* ------------------------------------------------------------------ */

export interface TabItem {
  key: string;
  /** 탭에 적히는 이름. 수를 함께 적는 탭("댓글 7")도 있습니다. */
  name: string;
}

/**
 * 탭 한 줄.
 *
 * `stretch`는 좁은 칸에서 탭이 칸을 고르게 나누게 합니다 — 재생 화면의
 * 댓글 패널이 그렇습니다. 넓은 본문에서는 왼쪽에 모아 둡니다.
 */
export function TabBar({
  label,
  tabs,
  current,
  onChange,
  stretch = false,
}: {
  label: string;
  tabs: TabItem[];
  current: string;
  onChange: (key: string) => void;
  stretch?: boolean;
}) {
  return (
    <div
      className={`${styles.tabs} ${stretch ? styles.tabsStretch : ""}`}
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab) => (
        <button
          className={`${styles.tab} ${current === tab.key ? styles.tabOn : ""}`}
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={current === tab.key}
          onClick={() => onChange(tab.key)}
        >
          {tab.name}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 작은 조각들                                                          */
/* ------------------------------------------------------------------ */

/** 이름 첫 글자를 넣은 둥근 자리. 회원 사진은 아직 없습니다. */
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
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
       * `suppressHydrationWarning`이 필요한 이유: 이 화면들은 빌드할 때 미리
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
/* 댓글 목록을 들고 있는 상태                                           */
/* ------------------------------------------------------------------ */

export interface CommentThread {
  comments: Comment[];
  /** 답글까지 센 수. 탭에 적는 "댓글 7"의 7입니다. */
  count: number;
  add: (body: string) => void;
  addReply: (parentId: string, body: string) => void;
}

/**
 * 댓글 목록과 그것을 바꾸는 두 가지 일.
 *
 * 화면이 이 훅을 부르고 결과를 `CommentSection`에 넘깁니다. 그래야 탭이
 * 댓글 수를 같이 셀 수 있습니다.
 */
export function useCommentThread(initial: Comment[]): CommentThread {
  const [comments, setComments] = useState<Comment[]>(initial);
  const me = useMe();

  // 새 댓글의 id. 저장되지 않는 값이므로 순번으로 충분합니다.
  const nextId = useRef(0);

  function make(body: string): Comment {
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

  return {
    comments,
    count: totalComments(comments),
    add(body) {
      setComments((current) => [...current, make(body)]);
    },
    addReply(parentId, body) {
      setComments((current) => insertReply(current, parentId, make(body)));
    },
  };
}

/* ------------------------------------------------------------------ */
/* 댓글칸                                                               */
/* ------------------------------------------------------------------ */

/**
 * 정렬 · 목록 · 입력칸.
 *
 * `fill`은 높이가 정해진 칸을 채우는 변형입니다 — 재생 화면의 댓글
 * 패널에서 목록만 스크롤하고 입력칸이 아래에 붙게 합니다.
 */
export function CommentSection({ thread, fill = false }: { thread: CommentThread; fill?: boolean }) {
  const [sort, setSort] = useState<Sort>("newest");
  const [likedComments, setLikedComments] = useState<string[]>([]);
  const [openThreads, setOpenThreads] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const me = useMe();

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

  function postComment() {
    const body = draft.trim();
    if (body.length === 0) return;
    thread.add(body);
    setDraft("");
    // 새 댓글이 바로 보이도록 최신순으로 되돌립니다. 인기순으로 보던
    // 중이라면 방금 쓴 글이 맨 아래에 묻혀 사라진 것처럼 보입니다.
    setSort("newest");
  }

  function postReply(parentId: string, body: string) {
    thread.addReply(parentId, body);
    // 답글을 달면 그 실타래는 펼쳐 둡니다.
    setOpenThreads((current) => (current.includes(parentId) ? current : [...current, parentId]));
    setReplyTo(null);
  }

  const ordered = [...thread.comments].sort((a, b) =>
    sort === "popular" ? likeCount(b) - likeCount(a) : b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <div className={`${styles.section} ${fill ? styles.sectionFill : ""}`}>
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

      <div className={styles.list}>
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

      <div className={styles.foot}>
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 거드는 함수들                                                        */
/* ------------------------------------------------------------------ */

/** 답글을 해당 댓글 아래에 넣은 새 목록을 돌려줍니다.
 *
 *  원본을 고치지 않고 새로 만듭니다 — React는 바뀐 것을 참조로 알아보므로,
 *  배열 안을 직접 고치면 화면이 다시 그려지지 않습니다. */
function insertReply(comments: Comment[], parentId: string, reply: Comment): Comment[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return { ...comment, replies: [...(comment.replies ?? []), reply] };
    }
    if (comment.replies) {
      return { ...comment, replies: insertReply(comment.replies, parentId, reply) };
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
export function useMe(): Creator {
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
