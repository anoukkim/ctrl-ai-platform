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
import type { Aspect } from "./aspect";
import type { MembershipStatus } from "./quarters";

export type { MembershipStatus };
export { MEMBERSHIP_LABEL } from "./quarters";

/** 각 상태가 무엇을 뜻하는지 설명하는 문구. 상세 화면에서만 씁니다. */
export const MEMBERSHIP_DESCRIPTION: Record<"active" | "inactive" | "former", string> = {
  active: "이번 분기에 참여 중이며 모든 창작 기능을 사용할 수 있습니다.",
  inactive: "이번 분기에는 참여하지 않지만, 만든 결과물은 그대로 남아 있습니다.",
  former: "커뮤니티를 떠났지만, 게시한 작품에는 만든 사람의 이름이 계속 표시됩니다.",
};

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

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "초안",
  building: "작업 중",
  ready: "완료",
  published: "게시됨",
};

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

export const MOCK_PROJECTS: Project[] = [
  {
    id: "p-habit",
    name: "습관 한눈에",
    description: "매일 습관을 체크하고 한 주의 달성률을 확인하는 앱입니다.",
    status: "building",
    framework: "Next.js",
    githubRepo: null,
    updatedAt: "2026-09-27",
  },
  {
    id: "p-budget",
    name: "가계부",
    description: "지출을 분류별로 기록하고 이번 달 합계를 보여 줍니다.",
    status: "published",
    framework: "Next.js",
    githubRepo: "yurikim/budget-book",
    updatedAt: "2026-09-12",
  },
  {
    id: "p-recipe",
    name: "레시피 보관함",
    description: "자주 만드는 요리를 저장하고 장보기 목록을 만들어 줍니다.",
    status: "draft",
    framework: "Next.js",
    githubRepo: null,
    updatedAt: "2026-09-02",
  },
];

export const MOCK_BUILD_OUTPUT = [
  "> next build",
  "  ✓ 빌드 완료",
  "  ✓ 페이지 생성 (3/3)",
  "  미리보기 준비됨 — /preview/p-habit",
];

/* ------------------------------------------------------------------ */
/* Video Generator                                                     */
/* ------------------------------------------------------------------ */

export interface VideoStep {
  label: string;
  detail: string;
  /** 각 단계를 담당하는 주체. 서비스 이름은 영어를 유지합니다. */
  provider: string;
}

export const VIDEO_STEPS: VideoStep[] = [
  {
    label: "아이디어 입력",
    detail: "만들고 싶은 영상을 한국어로 자유롭게 적습니다.",
    provider: "나",
  },
  {
    label: "Claude로 프롬프트 다듬기",
    detail: "Claude가 장면 설명과 대본을 정리해 줍니다.",
    provider: "Claude",
  },
  {
    label: "Higgsfield로 영상 생성",
    detail: "정리된 내용을 바탕으로 영상을 만듭니다.",
    provider: "Higgsfield",
  },
  {
    label: "결과 확인",
    detail: "완성된 영상이 내 보관함에 저장됩니다.",
    provider: "CTRL+AI",
  },
  {
    label: "YouTube에 게시",
    detail: "내 채널에 올리고 CtrlAITube에서 공유합니다.",
    provider: "YouTube",
  },
];

export const VIDEO_STYLE_OPTIONS = ["영화 같은 분위기", "다큐멘터리", "애니메이션", "타임랩스"];
export const VIDEO_DURATION_OPTIONS = ["10초", "15초", "20초", "30초"];
export const VIDEO_ASPECT_OPTIONS = ["9:16 Shorts", "16:9", "1:1"];

/** 사용자는 한국어로 프롬프트를 작성합니다. 영어로 쓸 필요가 없습니다. */
export const MOCK_VIDEO_PROMPT =
  "비 오는 밤 서울 골목을 걷는 사람의 모습을 감성적인 영화 분위기로 만들어줘. 네온사인이 젖은 도로에 반사되고 차분한 느낌의 15초 세로 영상.";

/* ---------- Video Generator: 반복 작업용 목업 상태 ---------- */

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

export const VIDEO_PROJECT_NAME = "서울의 밤";

export const MOCK_VIDEO_VERSIONS: VideoVersion[] = [
  {
    id: "v1",
    label: "v1",
    createdAt: "17:42",
    status: "ready",
    prompt:
      "비 오는 밤 서울 골목을 걷는 사람을 감성적인 영화 분위기의 15초 세로 영상으로 만들어줘. 네온사인이 젖은 도로에 반사되고 전체적으로 차분한 느낌.",
    artwork: ["#1e1b4b", "#7c3aed"],
    note: "첫 번째 생성 결과입니다.",
  },
  {
    id: "v2",
    label: "v2",
    createdAt: "17:48",
    status: "ready",
    prompt:
      "비 오는 밤 서울 골목을 걷는 사람을 감성적인 영화 분위기의 15초 세로 영상으로 만들어줘. 전체 조명을 낮추고 네온사인 반사를 더 강조해줘.",
    artwork: ["#0f172a", "#6d28d9"],
    note: "조명을 낮추고 네온 반사를 강조했습니다.",
  },
  {
    id: "v3",
    label: "v3",
    createdAt: "18:01",
    status: "ready",
    prompt:
      "비 오는 밤 서울 골목을 걷는 사람을 감성적인 영화 분위기의 15초 세로 영상으로 만들어줘. 조명은 어둡게, 네온 반사는 강조하고, 카메라는 느린 트래킹 샷으로 천천히 움직여줘.",
    artwork: ["#0c1222", "#4338ca"],
    note: "카메라를 느린 트래킹 샷으로 바꿨습니다.",
  },
];

export interface VideoChatMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  /** Claude가 프롬프트 수정본을 제안한 경우, 적용 버튼에 쓰입니다. */
  revisedPrompt?: string;
}

export const MOCK_VIDEO_CHAT: VideoChatMessage[] = [
  {
    id: "m1",
    role: "user",
    body: "조금 더 어두운 분위기로 바꿔줘.",
  },
  {
    id: "m2",
    role: "assistant",
    body: "좋아요. 전체 조명을 낮추고 네온 반사를 강조하는 방향으로 프롬프트를 수정했어요.",
    revisedPrompt:
      "비 오는 밤 서울 골목을 걷는 사람을 감성적인 영화 분위기의 15초 세로 영상으로 만들어줘. 전체 조명을 낮추고 네온사인 반사를 더 강조해줘.",
  },
  {
    id: "m3",
    role: "user",
    body: "카메라 움직임은 조금 더 천천히 해줘.",
  },
  {
    id: "m4",
    role: "assistant",
    body: "카메라 이동을 느린 트래킹 샷으로 조정해볼게요. 인물을 따라가는 속도를 줄이면 차분한 느낌이 더 살아납니다.",
    revisedPrompt:
      "비 오는 밤 서울 골목을 걷는 사람을 감성적인 영화 분위기의 15초 세로 영상으로 만들어줘. 조명은 어둡게, 네온 반사는 강조하고, 카메라는 느린 트래킹 샷으로 천천히 움직여줘.",
  },
];

/* ------------------------------------------------------------------ */
/* CtrlAIApps                                                         */
/* ------------------------------------------------------------------ */

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

// CtrlAIApps의 예시 앱(MOCK_APPS)은 ctrlaiapps-publish(2026-10-14)에서
// 지웠습니다 — 목록은 이제 회원이 실제로 게시한 앱입니다(`lib/apps.ts`).

export interface CommunityVideo {
  id: string;
  title: string;
  description: string;
  creator: Creator;
  publishedAt: string;
  duration: string;
  /**
   * 만들어진 영상의 가로세로 비율.
   *
   * 재생 화면의 틀을 정하는 값입니다. 세로 영상과 가로 영상을 같은 틀에
   * 넣으면 한쪽은 잘리거나 양옆이 비어 보이므로, 영상이 자기 비율을
   * 들고 다닙니다. Phase 8에서 실제 기록으로 옮길 때도 남는 값입니다.
   */
  aspectRatio: Aspect;
  /** 실제 기록에서는 YouTube 영상 ID가 저장됩니다. */
  youtubeVideoId: string | null;
  prompt: string;
  artwork: [string, string];
  reactions: Record<ReactionType, number>;
  /** CTRL+AI에 저장되는 커뮤니티 댓글. YouTube 댓글과 섞지 않습니다. */
  comments: Comment[];
  /** 별도 영역에 따로 표시되는 YouTube 댓글 수. */
  youtubeCommentCount: number;
}

/**
 * 예시 영상 세 편. 비율이 서로 다른 것은 일부러입니다.
 *
 * 재생 화면은 9:16·16:9·1:1을 모두 같은 두 칸 배치 안에서 보여 줘야
 * 합니다. 세 가지가 모두 들어 있지 않으면 세로 영상에서만 생기는 문제를
 * 화면을 열어 보고도 모르게 됩니다.
 */
export const MOCK_VIDEOS: CommunityVideo[] = [
  {
    id: "v-seoul-rain",
    title: "비 오는 서울의 밤",
    description: "Claude로 프롬프트를 다듬고 Higgsfield로 만든 15초 영상입니다.",
    creator: { username: "yurikim", displayName: "김유리", membership: "active" },
    publishedAt: "2026-09-25",
    duration: "15초",
    aspectRatio: "9:16",
    youtubeVideoId: null,
    prompt: MOCK_VIDEO_PROMPT,
    artwork: ["#1e1b4b", "#7c3aed"],
    reactions: { like: 86, useful: 5, interesting: 31 },
    comments: [
      {
        id: "vc1",
        author: { username: "minji", displayName: "박민지", membership: "active" },
        body: "젖은 도로에 비치는 불빛이 정말 예뻐요. 길이는 어떻게 정하셨어요?",
        createdAt: "2026-09-26",
        likes: 7,
        // 답글이 셋을 넘으면 재생 화면에서 접힙니다. 긴 실타래가 댓글
        // 칸을 다 차지하지 않는지 보려면 실제로 긴 것이 하나 있어야 합니다.
        replies: [
          {
            id: "vc1r1",
            author: { username: "yurikim", displayName: "김유리", membership: "active" },
            body: "15초에 9:16으로 만들었어요. 프롬프트는 Claude로 한 번 다듬었습니다.",
            createdAt: "2026-09-26",
            likes: 4,
          },
          {
            id: "vc1r2",
            author: { username: "minji", displayName: "박민지", membership: "active" },
            body: "9:16이라 휴대폰으로 보기 좋네요. Shorts로 올리실 건가요?",
            createdAt: "2026-09-27",
            likes: 1,
          },
          {
            id: "vc1r3",
            author: { username: "yurikim", displayName: "김유리", membership: "active" },
            body: "네, 채널 연결되면 올려 볼 생각이에요.",
            createdAt: "2026-09-28",
            likes: 2,
          },
          {
            id: "vc1r4",
            author: { username: "seojun", displayName: "이서준", membership: "active" },
            body: "저도 같은 분위기로 만들어 보고 싶어요. 프롬프트 참고하겠습니다.",
            createdAt: "2026-09-30",
            likes: 0,
          },
        ],
      },
      {
        id: "vc3",
        author: { username: "daeun", displayName: "최다은", membership: "inactive" },
        body: "빗소리까지 들리는 것 같아요. 다음 분기에 저도 다시 만들어 볼게요.",
        createdAt: "2026-10-01",
        likes: 3,
      },
    ],
    youtubeCommentCount: 12,
  },
  {
    id: "v-busan-dawn",
    title: "새벽 부산 해안",
    description: "해 뜰 무렵 해안선을 따라 천천히 날아가는 20초 영상입니다.",
    creator: { username: "minji", displayName: "박민지", membership: "active" },
    publishedAt: "2026-09-19",
    duration: "20초",
    aspectRatio: "16:9",
    youtubeVideoId: null,
    prompt:
      "해가 막 떠오르는 부산 해안선을 따라 천천히 날아가는 장면. 잔잔한 바다와 따뜻한 햇빛, 20초 영상으로 만들어줘.",
    artwork: ["#0369a1", "#f59e0b"],
    reactions: { like: 54, useful: 3, interesting: 22 },
    comments: [],
    youtubeCommentCount: 4,
  },
  {
    id: "v-paper-city",
    title: "종이로 만든 도시",
    description: "종이를 접어 만든 도시를 스톱모션처럼 표현한 10초 영상입니다.",
    creator: { username: "jihoon", displayName: "서지훈", membership: "former" },
    publishedAt: "2026-07-08",
    duration: "10초",
    aspectRatio: "1:1",
    youtubeVideoId: null,
    prompt:
      "종이를 접어 만든 것 같은 도시를 스톱모션 느낌으로 보여줘. 부드러운 조명에 10초 정도 길이로.",
    artwork: ["#be123c", "#fb7185"],
    reactions: { like: 39, useful: 2, interesting: 18 },
    comments: [
      {
        id: "vc2",
        author: { username: "seojun", displayName: "이서준", membership: "active" },
        body: "가끔 생각나서 다시 보게 되는 영상이에요.",
        createdAt: "2026-07-10",
        likes: 5,
      },
    ],
    youtubeCommentCount: 0,
  },
];

export function findVideo(id: string): CommunityVideo | undefined {
  return MOCK_VIDEOS.find((video) => video.id === id);
}

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

export interface QuarterSummary {
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: QuarterStatus;
  members: number;
}

export const MOCK_QUARTERS: QuarterSummary[] = [
  {
    code: "2026-Q4",
    name: "2026 Q4",
    startsAt: "2026-10-01",
    endsAt: "2026-12-31",
    status: "application_open",
    members: 5,
  },
  {
    code: "2026-Q3",
    name: "2026 Q3",
    startsAt: "2026-07-01",
    endsAt: "2026-09-30",
    status: "closed",
    members: 4,
  },
  {
    code: "2026-Q1",
    name: "2026 Q1",
    startsAt: "2026-01-01",
    endsAt: "2026-03-31",
    status: "closed",
    members: 3,
  },
];

export interface AdminMember {
  username: string;
  displayName: string;
  role: "admin" | "member";
  membership: MembershipStatus;
  quarter: string;
  buildBudgetKrw: number;
  videoBudgetKrw: number;
}

/* ------------------------------------------------------------------ */
/* 공통 도우미                                                          */
/* ------------------------------------------------------------------ */

export function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

/** 650000 -> "650K", 2000000 -> "2M". 좁은 자리에 큰 수를 넣을 때 씁니다. */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(2)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(0)}K`;
  }
  return String(value);
}

/** 반응 수의 합계. 카드와 "인기순" 정렬이 같은 값을 쓰도록 한 곳에 둡니다. */
export function totalReactions(reactions: Record<ReactionType, number>): number {
  return reactions.like + reactions.useful + reactions.interesting;
}
