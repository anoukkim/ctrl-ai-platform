/**
 * Phase 0 목업 데이터.
 *
 * 이 파일의 내용은 모두 예시입니다. 백엔드에서 가져오는 값이 아니며,
 * Claude / Higgsfield / GitHub / YouTube 중 어느 것도 연결되어 있지 않습니다.
 *
 * 언어 규칙:
 * - 제품/기능 이름(CTRL+AI, Chat, Project Builder, Video Generator,
 *   CtrlAIApps, CtrlAITube, Usage, Profile, Admin)과 외부 서비스 이름
 *   (Claude, Higgsfield, GitHub, YouTube)은 영어를 유지합니다.
 * - 그 외 사용자가 읽고 쓰는 모든 텍스트는 한국어로 작성합니다.
 *
 * 기능이 실제로 구현되면 해당 데이터는 백엔드로 옮기고 여기서 삭제합니다.
 */

/**
 * 회원 상태는 이제 백엔드에서 옵니다.
 *
 * 타입과 한국어 표기는 lib/quarters.ts 하나만 두고 여기서는 다시 내보내기만
 * 합니다. 같은 뜻의 상수를 두 곳에 두면 한쪽만 고쳐져 어긋나기 때문입니다.
 * 아직 목업인 화면(게시된 앱·영상의 만든 사람 표시, Phase 5/8)이 이 이름을
 * 쓰고 있어 재export를 남겨 둡니다.
 */
import type { MembershipStatus } from "./quarters";

export type { MembershipStatus };
export { MEMBERSHIP_LABEL } from "./quarters";

export interface Creator {
  username: string;
  displayName: string;
  membership: MembershipStatus;
}

/** YYYY-MM-DD 를 2026.10.01 형태로 바꿉니다. */
export function formatDate(iso: string): string {
  return iso.replaceAll("-", ".");
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

// Chat 첫 화면의 카드는 제품 문구라 `lib/chat-examples.ts`로 옮겼습니다.

/* ------------------------------------------------------------------ */
/* Project Builder                                                     */
/* ------------------------------------------------------------------ */

export type ProjectStatus = "draft" | "building" | "ready" | "published";

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  /** 프레임워크 이름 등 기술 용어는 영어를 유지합니다. */
  framework: string;
  githubRepo: string | null;
  updatedAt: string;
}

/**
 * 하나의 영상 프로젝트는 여러 버전을 가질 수 있습니다.
 * 아이디어 → 생성 → 확인 → Claude와 상의 → 수정 → 다시 생성 → 최종본 선택.
 */
export interface VideoVersion {
  id: string;
  label: string;
  createdAt: string;
  status: "ready" | "generating";
  prompt: string;
  /** 미리보기 배경을 CSS로 그리기 위한 두 가지 색. */
  artwork: [string, string];
  note: string;
}

export type ReactionType = "like" | "useful" | "interesting";

export const REACTION_LABEL: Record<ReactionType, string> = {
  like: "좋아요",
  useful: "유용해요",
  interesting: "흥미로워요",
};

export interface Comment {
  id: string;
  author: Creator;
  body: string;
  createdAt: string;
  /** 다른 회원이 누른 공감 수. 인기순 정렬의 기준이기도 합니다. */
  likes: number;
  replies?: Comment[];
  /** 내 댓글(실제 댓글에서만 뜻이 있음, promo-videos). */
  mine?: boolean;
}

/** 답글까지 포함한 전체 댓글 수.
 *
 *  "댓글 N개"라고 적는 자리에서는 답글도 대화의 한 조각이므로 함께
 *  셉니다. 목록 화면의 카드와 상세 화면의 탭이 같은 수를 보여 주도록
 *  한 군데에만 둡니다. */
export function totalComments(comments: Comment[]): number {
  return comments.reduce(
    (sum, comment) => sum + 1 + (comment.replies ? totalComments(comment.replies) : 0),
    0,
  );
}

// CtrlAIApps의 예시 앱(MOCK_APPS)은 ctrlaiapps-publish(2026-10-14)에서,
// CtrlAITube의 예시 영상(MOCK_VIDEOS)은 fix-promo-video-placement
// (2026-10-16)에서 지웠습니다 — 두 목록 모두 이제 실제 행입니다
// (`lib/apps.ts`, `lib/tube.ts`).

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export type QuarterStatus = "draft" | "application_open" | "active" | "closed";

export const QUARTER_STATUS_LABEL: Record<QuarterStatus, string> = {
  draft: "준비 중",
  application_open: "신청 접수 중",
  active: "진행 중",
  closed: "종료",
};
