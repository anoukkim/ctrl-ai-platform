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

export interface ShortcutAction {
  title: string;
  description: string;
  href: string;
  /** 카드에 쓸 lucide 아이콘 이름. 화면이 이 이름을 아이콘으로 바꿉니다.
   *  데이터 파일에는 컴포넌트를 두지 않으려고 이름만 적습니다. */
  icon: "build" | "video" | "apps" | "tube";
}

export const CHAT_SHORTCUTS: ShortcutAction[] = [
  {
    title: "앱 만들기",
    description: "만들고 싶은 것을 이야기하면 Project Builder에서 시작합니다.",
    href: "/builder",
    icon: "build",
  },
  {
    title: "영상 만들기",
    description: "떠오르는 장면을 적으면 짧은 영상으로 만들어 봅니다.",
    href: "/video",
    icon: "video",
  },
  {
    title: "CtrlAIApps 둘러보기",
    description: "다른 회원들이 만든 앱을 구경해 보세요.",
    href: "/ctrlaistore",
    icon: "apps",
  },
  {
    title: "CtrlAITube 보기",
    description: "커뮤니티에서 만든 영상을 감상해 보세요.",
    href: "/ctrlaitube",
    icon: "tube",
  },
];

/* ------------------------------------------------------------------ */
/* Project Builder                                                     */
/* ------------------------------------------------------------------ */

export type ProjectStatus = "draft" | "building" | "ready" | "published" | "archived";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "초안",
  building: "작업 중",
  ready: "완료",
  published: "게시됨",
  archived: "보관됨",
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

/** Project Builder의 파일 목록 예시. 파일 이름은 영어를 유지합니다. */
export interface FileNode {
  name: string;
  kind: "folder" | "file";
  depth: number;
  active?: boolean;
}

export const MOCK_FILE_TREE: FileNode[] = [
  { name: "app", kind: "folder", depth: 0 },
  { name: "page.tsx", kind: "file", depth: 1, active: true },
  { name: "layout.tsx", kind: "file", depth: 1 },
  { name: "globals.css", kind: "file", depth: 1 },
  { name: "components", kind: "folder", depth: 0 },
  { name: "HabitForm.tsx", kind: "file", depth: 1 },
  { name: "HabitList.tsx", kind: "file", depth: 1 },
  { name: "package.json", kind: "file", depth: 0 },
  { name: "README.md", kind: "file", depth: 0 },
];

export const MOCK_CODE_SAMPLE = `export default function Page() {
  const [habits, setHabits] = useState<Habit[]>([]);

  return (
    <main className="page">
      <h1>습관 한눈에</h1>
      <HabitForm onAdd={(habit) => setHabits([...habits, habit])} />
      <HabitList items={habits} />
    </main>
  );
}`;

/** 파일별 내용. 파일을 고르면 코드 영역이 바뀌도록 하기 위한 예시입니다. */
export const MOCK_FILE_CONTENTS: Record<string, string> = {
  "page.tsx": MOCK_CODE_SAMPLE,
  "layout.tsx": `export default function Layout({ children }: LayoutProps) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}`,
  "globals.css": `body {
  background: #001433;
  color: #f2f2f2;
  font-family: "Pretendard", system-ui, sans-serif;
}`,
  "HabitForm.tsx": `export function HabitForm({ onAdd }: HabitFormProps) {
  const [name, setName] = useState("");

  return (
    <form onSubmit={() => onAdd({ name, done: false })}>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit">습관 추가</button>
    </form>
  );
}`,
  "HabitList.tsx": `export function HabitList({ items }: HabitListProps) {
  return (
    <ul>
      {items.map((habit) => (
        <li key={habit.name}>{habit.name}</li>
      ))}
    </ul>
  );
}`,
  "package.json": `{
  "name": "habit-at-a-glance",
  "private": true,
  "dependencies": {
    "next": "16.3.6",
    "react": "19.2.8"
  }
}`,
  "README.md": `# 습관 한눈에

매일 습관을 체크하고 한 주의 달성률을 확인하는 앱입니다.
CTRL+AI의 Project Builder로 만들었습니다.`,
};

export const MOCK_BUILDER_CHAT: { role: "user" | "assistant"; body: string }[] = [
  { role: "user", body: "매일 체크할 수 있는 간단한 습관 관리 앱을 만들고 싶어요." },
  {
    role: "assistant",
    body: "좋아요. 습관을 추가하고 매일 체크하는 화면을 먼저 만들었어요. 색상이나 기능을 바꾸고 싶으면 편하게 말씀해 주세요.",
  },
  { role: "user", body: "이번 주 달성률을 보여주는 그래프를 추가해줘." },
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

export interface AppScreenshot {
  /** 화면을 설명하는 짧은 말. 그림을 못 보는 사람에게는 이것이 그림입니다. */
  label: string;
  /** 스크린샷 대신 CSS로 그리는 두 가지 색상. 실제 이미지는 Phase 5에서
   *  올라갑니다 — 그때 이 자리에 주소가 들어옵니다. */
  artwork: [string, string];
}

/**
 * 주요 기능 하나.
 *
 * 예전에는 이 자리가 짧은 말 몇 줄이었습니다. "투표 만들기", "결과 보기"
 * — 무엇을 뜻하는지 이미 아는 사람만 알아볼 수 있는 목록이었습니다.
 * `description` 한 줄을 함께 두면 처음 보는 사람도 그 기능이 자기에게
 * 쓸모가 있는지 그 자리에서 판단할 수 있습니다.
 */
export interface AppFeature {
  /** 카드에 쓸 아이콘 이름. 데이터 파일에 컴포넌트를 두지 않으려고
   *  이름만 적고, 화면이 이것을 lucide 아이콘으로 바꿉니다
   *  (`CHAT_SHORTCUTS`와 같은 방식입니다). */
  icon: AppFeatureIcon;
  title: string;
  /** 한 줄 설명. 길면 카드가 들쭉날쭉해지므로 한 문장으로 적습니다. */
  description: string;
}

/** 기능 카드가 쓸 수 있는 아이콘. 새 이름을 쓰려면 화면 쪽
 *  `FEATURE_ICON`에도 함께 넣어야 하므로 타입으로 묶어 둡니다 — 그러면
 *  한쪽만 고쳤을 때 `tsc`가 잡아 줍니다. */
export type AppFeatureIcon =
  | "checklist"
  | "chart"
  | "calendar"
  | "link"
  | "share"
  | "people"
  | "bell"
  | "search"
  | "sparkle"
  | "clock"
  | "note"
  | "cart"
  | "repeat"
  | "pen"
  | "tag"
  | "vote";

/**
 * 업데이트 한 줄.
 *
 * 예전에는 `note` 한 문장뿐이어서 날짜와 글이 한 줄에 붙어 흘렀습니다.
 * 판 번호 · 날짜 · 제목 · 바뀐 것들로 나누면 세로 타임라인이 각각을 제
 * 자리에 놓을 수 있습니다.
 */
export interface AppUpdate {
  /** 사람이 읽는 판 번호. "v1.0"처럼 적습니다. */
  version: string;
  date: string;
  /** 이 판이 무엇이었는지 한 줄로. */
  title: string;
  /** 바뀐 것들. 하나에서 셋 사이로 적습니다 — 넷을 넘으면 타임라인이
   *  읽히지 않고 쌓이기만 합니다. */
  changes: string[];
}

export interface App {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  creator: Creator;
  publishedAt: string;
  category: string;
  launchUrl: string | null;
  githubRepo: string | null;
  /** 대표 이미지 대신 CSS로 그리는 두 가지 색상. */
  artwork: [string, string];
  reactions: Record<ReactionType, number>;
  comments: Comment[];
  /** 앱이 하는 일. 소개 탭의 "주요 기능" 칸이 이것을 카드로 그립니다. */
  features: AppFeature[];
  /** 앱 안을 보여 주는 화면 모음. */
  screenshots: AppScreenshot[];
  /**
   * 업데이트 기록. **최신이 앞**입니다.
   *
   * 마지막 수정일을 따로 들고 다니지 않고 이 목록의 첫 줄에서 읽습니다
   * (`lastUpdated`). 같은 사실을 두 곳에 적으면 한쪽만 고쳐집니다.
   */
  updates: AppUpdate[];
}

export const MOCK_APPS: App[] = [
  {
    slug: "habit-at-a-glance",
    name: "습관 한눈에",
    tagline: "오늘 할 일을 체크하고 한 주를 돌아보세요.",
    description:
      "매일 습관을 기록하고 한 주의 달성률을 확인할 수 있는 간단한 앱입니다. Project Builder에서 한국어로 설명해 만들었고, Claude와 몇 번 더 이야기하며 다듬었습니다.",
    creator: { username: "yurikim", displayName: "김유리", membership: "active" },
    publishedAt: "2026-09-12",
    category: "생산성",
    // 넷 중 하나만 실행 주소가 있습니다. 실행 주소가 있을 때와 없을 때
    // 버튼이 서로 달라야 하므로(있으면 열리고, 없으면 "실행 준비 중"),
    // 두 경우가 모두 예시에 있어야 화면을 열어 보고 확인할 수 있습니다.
    // example.com은 문서용으로 비워 둔 주소라 실제 어딘가로 가지 않습니다.
    launchUrl: "https://habit-at-a-glance.example.com",
    githubRepo: "yurikim/habit-at-a-glance",
    artwork: ["#3355ff", "#7c3aed"],
    reactions: { like: 24, useful: 11, interesting: 6 },
    features: [
      {
        icon: "checklist",
        title: "오늘의 체크",
        description: "오늘 할 습관만 모아 보여 주고 한 번에 체크합니다.",
      },
      {
        icon: "chart",
        title: "한 주 달성률",
        description: "일곱 칸짜리 막대로 이번 주가 어땠는지 보여 줍니다.",
      },
      {
        icon: "bell",
        title: "시간 알림",
        description: "습관마다 정한 시각에 한 번씩 알려 줍니다.",
      },
      {
        icon: "repeat",
        title: "연속 기록",
        description: "며칠째 이어 가고 있는지 세어 둡니다.",
      },
    ],
    screenshots: [
      { label: "오늘 할 일 목록", artwork: ["#3355ff", "#7c3aed"] },
      { label: "주간 달성률 화면", artwork: ["#4338ca", "#6366f1"] },
      { label: "습관 추가 화면", artwork: ["#312e81", "#8b5cf6"] },
      { label: "알림 설정 화면", artwork: ["#1e1b4b", "#6d28d9"] },
    ],
    updates: [
      {
        version: "v1.2",
        date: "2026-09-28",
        title: "주간 달성률 그래프",
        changes: [
          "한 주를 일곱 칸 막대로 보여 주는 화면을 추가했습니다.",
          "지난주와 이번 주를 나란히 둘 수 있습니다.",
        ],
      },
      {
        version: "v1.1",
        date: "2026-09-20",
        title: "지운 습관이 남던 문제",
        changes: [
          "습관을 지운 뒤에도 기록이 남던 문제를 고쳤습니다.",
          "체크를 되돌릴 때 날짜가 밀리던 것도 함께 고쳤습니다.",
        ],
      },
      {
        version: "v1.0",
        date: "2026-09-12",
        title: "CtrlAIApps에 처음 게시",
        changes: ["습관 등록과 오늘 체크만 있는 첫 판입니다."],
      },
    ],
    comments: [
      {
        id: "c1",
        author: { username: "minji", displayName: "박민지", membership: "active" },
        body: "화면이 깔끔해서 사용하기 좋아요.",
        createdAt: "2026-09-14",
        likes: 3,
        replies: [
          {
            id: "c1r1",
            author: { username: "yurikim", displayName: "김유리", membership: "active" },
            body: "감사합니다. 처음엔 복잡했는데 Claude에게 더 단순하게 만들어 달라고 했어요.",
            createdAt: "2026-09-14",
            likes: 1,
          },
        ],
      },
      {
        id: "c2",
        author: { username: "seojun", displayName: "이서준", membership: "active" },
        body: "주간 통계도 추가되면 좋을 것 같아요.",
        createdAt: "2026-09-18",
        likes: 5,
        // 답글이 셋을 넘으면 접힙니다. 긴 실타래가 댓글칸을 다 차지하지
        // 않는지 보려면 실제로 긴 것이 하나 있어야 합니다.
        replies: [
          {
            id: "c2r1",
            author: { username: "yurikim", displayName: "김유리", membership: "active" },
            body: "지금 그래프 추가하는 중이에요. 다음 주에 다시 올려볼게요.",
            createdAt: "2026-09-19",
            likes: 2,
          },
          {
            id: "c2r2",
            author: { username: "seojun", displayName: "이서준", membership: "active" },
            body: "기다리고 있을게요!",
            createdAt: "2026-09-19",
            likes: 0,
          },
          {
            id: "c2r3",
            author: { username: "daeun", displayName: "최다은", membership: "inactive" },
            body: "저도 그 기능을 기다리고 있었어요.",
            createdAt: "2026-09-21",
            likes: 1,
          },
          {
            id: "c2r4",
            author: { username: "yurikim", displayName: "김유리", membership: "active" },
            body: "올렸습니다. 한 주 단위로 막대가 보이도록 했어요.",
            createdAt: "2026-09-28",
            likes: 4,
          },
        ],
      },
    ],
  },
  {
    slug: "meeting-notes",
    name: "회의록 정리",
    tagline: "메모를 붙여넣으면 할 일이 정리됩니다.",
    description:
      "회의 중에 적어둔 메모를 붙여넣으면 짧은 요약과 담당자별 할 일 목록을 만들어 줍니다.",
    creator: { username: "minji", displayName: "박민지", membership: "active" },
    publishedAt: "2026-08-30",
    category: "업무",
    launchUrl: null,
    githubRepo: null,
    artwork: ["#0ea5e9", "#22d3ee"],
    reactions: { like: 41, useful: 33, interesting: 9 },
    features: [
      {
        icon: "note",
        title: "메모 붙여넣기",
        description: "회의 중에 적은 글을 그대로 붙여넣으면 됩니다.",
      },
      {
        icon: "sparkle",
        title: "세 줄 요약",
        description: "긴 메모에서 결정된 것만 추려 줍니다.",
      },
      {
        icon: "people",
        title: "담당자별 할 일",
        description: "이름이 나온 자리를 찾아 할 일을 사람별로 나눕니다.",
      },
      {
        icon: "share",
        title: "링크로 공유",
        description: "정리된 회의록을 링크 하나로 팀에 보냅니다.",
      },
    ],
    screenshots: [
      { label: "메모 입력 화면", artwork: ["#0ea5e9", "#22d3ee"] },
      { label: "요약 결과 화면", artwork: ["#0284c7", "#67e8f9"] },
      { label: "할 일 목록 화면", artwork: ["#0369a1", "#38bdf8"] },
    ],
    updates: [
      {
        version: "v1.2",
        date: "2026-09-18",
        title: "공유 링크",
        changes: ["정리된 회의록을 링크로 내보낼 수 있습니다."],
      },
      {
        version: "v1.1",
        date: "2026-09-10",
        title: "담당자 자동 인식",
        changes: [
          "메모에서 이름을 찾아 담당자를 자동으로 붙입니다.",
          "담당자가 없는 할 일은 따로 모읍니다.",
        ],
      },
      {
        version: "v1.0",
        date: "2026-08-30",
        title: "CtrlAIApps에 처음 게시",
        changes: ["메모를 붙여넣고 요약을 받는 것까지 됩니다."],
      },
    ],
    comments: [
      {
        id: "c3",
        author: { username: "daeun", displayName: "최다은", membership: "inactive" },
        body: "회의 끝나고 바로 정리돼서 편했어요. 매주 쓰고 있습니다.",
        createdAt: "2026-09-02",
        likes: 4,
      },
    ],
  },
  {
    slug: "recipe-box",
    name: "레시피 보관함",
    tagline: "즐겨 만드는 요리와 장보기 목록을 한 곳에.",
    description:
      "자주 만드는 요리를 저장하고 인원수에 맞춰 양을 조절할 수 있습니다. 한 주치 장보기 목록도 한 번에 만들어 줍니다.",
    creator: { username: "jihoon", displayName: "서지훈", membership: "former" },
    publishedAt: "2026-06-21",
    category: "생활",
    launchUrl: null,
    githubRepo: null,
    artwork: ["#f97316", "#ef4444"],
    reactions: { like: 18, useful: 14, interesting: 4 },
    features: [
      {
        icon: "note",
        title: "레시피 보관",
        description: "자주 만드는 요리를 재료와 함께 저장해 둡니다.",
      },
      {
        icon: "people",
        title: "인원수 맞춤",
        description: "먹을 사람 수를 바꾸면 재료 양이 따라 바뀝니다.",
      },
      {
        icon: "cart",
        title: "장보기 목록",
        description: "한 주치 요리에 필요한 재료를 한 장으로 모아 줍니다.",
      },
      {
        icon: "search",
        title: "재료로 찾기",
        description: "냉장고에 있는 재료를 적으면 만들 수 있는 요리를 찾아 줍니다.",
      },
    ],
    screenshots: [
      { label: "레시피 목록 화면", artwork: ["#f97316", "#ef4444"] },
      { label: "레시피 상세 화면", artwork: ["#ea580c", "#fb7185"] },
      { label: "장보기 목록 화면", artwork: ["#c2410c", "#fb923c"] },
    ],
    updates: [
      {
        version: "v1.1",
        date: "2026-07-05",
        title: "재료로 찾기",
        changes: ["가지고 있는 재료로 만들 수 있는 요리를 찾아 줍니다."],
      },
      {
        version: "v1.0",
        date: "2026-06-21",
        title: "CtrlAIApps에 처음 게시",
        changes: [
          "레시피를 저장하고 인원수에 맞춰 양을 바꿀 수 있습니다.",
          "장보기 목록을 한 번에 만들어 줍니다.",
        ],
      },
    ],
    comments: [
      {
        id: "c4",
        author: { username: "minji", displayName: "박민지", membership: "active" },
        body: "지난 분기 앱이지만 아직도 잘 쓰고 있어요.",
        createdAt: "2026-07-03",
        likes: 2,
      },
    ],
  },
  {
    slug: "word-cards",
    name: "단어 카드",
    tagline: "외우고 싶은 내용을 복습 카드로.",
    description:
      "외우고 싶은 내용을 목록으로 붙여넣으면 복습 카드가 만들어지고, 복습할 시점을 알려 줍니다.",
    creator: { username: "seojun", displayName: "이서준", membership: "active" },
    publishedAt: "2026-09-20",
    category: "학습",
    launchUrl: null,
    githubRepo: null,
    artwork: ["#16a34a", "#84cc16"],
    reactions: { like: 12, useful: 8, interesting: 7 },
    // 방금 게시해 아직 기능 설명도 화면도 올리지 않은 앱입니다. 비어
    // 있을 때 소개 탭이 어떻게 보이는지는, 실제로 비어 있는 예시가 하나
    // 있어야만 브라우저에서 확인할 수 있습니다.
    features: [],
    screenshots: [],
    updates: [
      {
        version: "v1.0",
        date: "2026-09-20",
        title: "CtrlAIApps에 처음 게시",
        changes: ["붙여넣은 목록으로 복습 카드를 만듭니다."],
      },
    ],
    comments: [],
  },
  {
    slug: "weekly-review",
    name: "주간 회고",
    tagline: "한 주에 한 번, 세 가지만 적습니다.",
    description:
      "잘된 일, 아쉬운 일, 다음 주에 할 일을 세 칸에 적는 회고 앱입니다. 지난 회고를 나란히 두고 볼 수 있습니다.",
    creator: { username: "yurikim", displayName: "김유리", membership: "active" },
    publishedAt: "2026-07-18",
    category: "생산성",
    launchUrl: null,
    githubRepo: "yurikim/weekly-review",
    artwork: ["#2563eb", "#38bdf8"],
    reactions: { like: 9, useful: 15, interesting: 3 },
    features: [
      {
        icon: "pen",
        title: "세 칸 회고",
        description: "잘된 일, 아쉬운 일, 다음 주 할 일만 적습니다.",
      },
      {
        icon: "calendar",
        title: "지난 회고 비교",
        description: "저번 주 회고를 옆에 두고 적을 수 있습니다.",
      },
      {
        icon: "bell",
        title: "금요일 알림",
        description: "한 주가 끝날 때 한 번만 알려 줍니다.",
      },
    ],
    screenshots: [
      { label: "이번 주 회고 화면", artwork: ["#2563eb", "#38bdf8"] },
      { label: "지난 회고 비교 화면", artwork: ["#1d4ed8", "#60a5fa"] },
      { label: "알림 설정 화면", artwork: ["#1e3a8a", "#7dd3fc"] },
    ],
    updates: [
      {
        version: "v1.1",
        date: "2026-08-02",
        title: "지난 회고 나란히 보기",
        changes: ["이번 주를 적으면서 저번 주 회고를 옆에서 볼 수 있습니다."],
      },
      {
        version: "v1.0",
        date: "2026-07-18",
        title: "CtrlAIApps에 처음 게시",
        changes: ["세 칸짜리 회고를 적고 저장합니다."],
      },
    ],
    comments: [],
  },
  {
    slug: "team-poll",
    name: "팀 투표",
    tagline: "링크 하나로 의견을 모읍니다.",
    description:
      "날짜나 선택지를 적어 올리면 투표 링크가 만들어집니다. 누가 아직 고르지 않았는지 한눈에 보입니다.",
    creator: { username: "minji", displayName: "박민지", membership: "active" },
    publishedAt: "2026-09-26",
    category: "업무",
    launchUrl: null,
    githubRepo: null,
    artwork: ["#10b981", "#34d399"],
    reactions: { like: 16, useful: 7, interesting: 11 },
    features: [
      {
        icon: "vote",
        title: "투표 만들기",
        description: "날짜나 선택지를 적으면 투표 한 장이 만들어집니다.",
      },
      {
        icon: "link",
        title: "링크로 초대",
        description: "가입하지 않아도 링크만 있으면 누구나 고를 수 있습니다.",
      },
      {
        icon: "chart",
        title: "결과 보기",
        description: "고른 사람 수가 막대로 바로 쌓입니다.",
      },
      {
        icon: "clock",
        title: "아직 안 고른 사람",
        description: "누가 아직 응답하지 않았는지 한눈에 보입니다.",
      },
    ],
    screenshots: [
      { label: "투표 만들기 화면", artwork: ["#10b981", "#34d399"] },
      { label: "초대 링크 화면", artwork: ["#059669", "#4ade80"] },
      { label: "결과 화면", artwork: ["#047857", "#6ee7b7"] },
    ],
    updates: [
      {
        version: "v1.2",
        date: "2026-09-30",
        title: "아직 안 고른 사람 보기",
        changes: ["응답하지 않은 사람을 따로 모아 보여 줍니다."],
      },
      {
        version: "v1.1",
        date: "2026-09-28",
        title: "날짜 투표",
        changes: [
          "선택지 대신 날짜를 올리면 달력으로 고를 수 있습니다.",
          "같은 날에 몰린 표가 진하게 보입니다.",
        ],
      },
      {
        version: "v1.0",
        date: "2026-09-26",
        title: "CtrlAIApps에 처음 게시",
        changes: ["선택지를 적고 링크를 만드는 것까지 됩니다."],
      },
    ],
    comments: [],
  },
];

export function findApp(slug: string): App | undefined {
  return MOCK_APPS.find((app) => app.slug === slug);
}

/** 마지막으로 고친 날. 업데이트 기록의 첫 줄이 곧 그 날짜입니다. */
export function lastUpdated(app: App): string | null {
  return app.updates[0]?.date ?? null;
}

/** 같은 회원이 만든 다른 앱. 상세 화면 아래에 모아 보여 줍니다. */
export function otherAppsBy(username: string, exceptSlug: string): App[] {
  return MOCK_APPS.filter((app) => app.creator.username === username && app.slug !== exceptSlug);
}

/* ------------------------------------------------------------------ */
/* CtrlAITube                                                          */
/* ------------------------------------------------------------------ */

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
/* Usage                                                               */
/* ------------------------------------------------------------------ */

/**
 * 사용 내역 한 줄.
 *
 * 금액(원)과 어느 주머니에서 나갔는지를 함께 적습니다. 제공자가 실제로
 * 청구한 금액과 CTRL+AI가 예산에서 차감한 금액은 다를 수 있어, 백엔드의
 * UsageEvent는 둘을 따로 보관합니다.
 */
export interface UsageEvent {
  date: string;
  category: "Build" | "Video";
  detail: string;
  provider: string;
  chargedKrw: number;
  source: "동아리 지원" | "개인 잔액";
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
