/**
 * Phase 0 목업 데이터.
 *
 * 이 파일의 내용은 모두 예시입니다. 백엔드에서 가져오는 값이 아니며,
 * Claude / Higgsfield / GitHub / YouTube 중 어느 것도 연결되어 있지 않습니다.
 *
 * 언어 규칙:
 * - 제품/기능 이름(Ctrl AI, Chat, Project Builder, Video Generator,
 *   CtrlAI Apps, CtrlAITube, Usage, Profile, Admin)과 외부 서비스 이름
 *   (Claude, Higgsfield, GitHub, YouTube)은 영어를 유지합니다.
 * - 그 외 사용자가 읽고 쓰는 모든 텍스트는 한국어로 작성합니다.
 *
 * 기능이 실제로 구현되면 해당 데이터는 백엔드로 옮기고 여기서 삭제합니다.
 */

/** 시즌별 회원 상태. Ctrl AI는 시즌 단위로 운영됩니다. */
export type MembershipStatus = "active" | "inactive" | "former";

/**
 * 회원 상태 표기.
 *
 * "탈퇴 회원"은 계정을 지웠다는 뜻이 아닙니다. 이미 게시한 앱과 영상에는
 * 만든 사람의 이름이 계속 남아야 하므로 "삭제된 회원"이라고 쓰지 않습니다.
 */
export const MEMBERSHIP_LABEL: Record<MembershipStatus, string> = {
  active: "활동 회원",
  inactive: "비활동 회원",
  former: "탈퇴 회원",
};

/** 각 상태가 무엇을 뜻하는지 설명하는 문구. */
export const MEMBERSHIP_DESCRIPTION: Record<MembershipStatus, string> = {
  active: "이번 시즌에 참여 중이며 모든 창작 기능을 사용할 수 있습니다.",
  inactive: "이번 시즌에는 참여하지 않지만, 만든 결과물은 그대로 남아 있습니다.",
  former: "커뮤니티를 떠났지만, 게시한 작품에는 만든 사람의 이름이 계속 표시됩니다.",
};

export interface Creator {
  username: string;
  displayName: string;
  membership: MembershipStatus;
}

export const CURRENT_SEASON = "2026 Season 2";

/**
 * 시즌은 4개월 단위입니다. (분기/quarter가 아닙니다.)
 *
 * `TODAY`는 목업용으로 고정한 기준일입니다. 서버와 브라우저가 항상 같은
 * 값을 계산하도록 고정해 두었습니다. 실제 시즌 기능이 생기면 이 상수를
 * `new Date()`로 바꾸기만 하면 됩니다.
 */
export const SEASON_RANGE = {
  name: CURRENT_SEASON,
  startsAt: "2026-09-01",
  endsAt: "2026-12-31",
  today: "2026-09-29",
};

/** YYYY-MM-DD 를 2026.09.01 형태로 바꿉니다. */
export function formatDate(iso: string): string {
  return iso.replaceAll("-", ".");
}

/** 두 날짜 사이의 남은 일수. 시간대 차이를 없애려고 UTC로 계산합니다. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** 시즌 종료까지 남은 일수. */
export function seasonDaysRemaining(): number {
  return daysBetween(SEASON_RANGE.today, SEASON_RANGE.endsAt);
}

/** 시즌이 얼마나 지났는지(%). 사이드바 막대에 씁니다. */
export function seasonProgressPercent(): number {
  const total = daysBetween(SEASON_RANGE.startsAt, SEASON_RANGE.endsAt);
  const passed = daysBetween(SEASON_RANGE.startsAt, SEASON_RANGE.today);
  return total === 0 ? 0 : Math.min(100, Math.round((passed / total) * 100));
}

export const CURRENT_USER = {
  username: "yurikim",
  displayName: "김유리",
  membership: "active" as MembershipStatus,
  role: "admin" as "admin" | "member",
  season: CURRENT_SEASON,
  seasonsParticipated: ["2026 Season 1", "2026 Season 2"],
  github: { connected: false as const, label: "연결 안 됨" },
  youtube: { connected: false as const, label: "연결 안 됨" },
};

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export interface ShortcutAction {
  title: string;
  description: string;
  href: string;
  /** 카드에 표시할 기호. 아이콘 라이브러리를 쓰지 않기 위해 문자로 둡니다. */
  glyph: string;
}

export const CHAT_SHORTCUTS: ShortcutAction[] = [
  {
    title: "앱 만들기",
    description: "만들고 싶은 것을 이야기하면 Project Builder에서 시작합니다.",
    href: "/builder",
    glyph: "◆",
  },
  {
    title: "영상 만들기",
    description: "떠오르는 장면을 적으면 짧은 영상으로 만들어 봅니다.",
    href: "/video",
    glyph: "▶",
  },
  {
    title: "CtrlAI Apps 둘러보기",
    description: "다른 회원들이 만든 앱을 구경해 보세요.",
    href: "/ctrlaistore",
    glyph: "▣",
  },
  {
    title: "CtrlAITube 보기",
    description: "커뮤니티에서 만든 영상을 감상해 보세요.",
    href: "/ctrlaitube",
    glyph: "◉",
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
  background: #0b0e14;
  color: #e4e8f0;
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
Ctrl AI의 Project Builder로 만들었습니다.`,
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
    provider: "Ctrl AI",
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

/**
 * Claude 응답을 흉내 내는 표입니다. 실제 호출은 하지 않고, 입력에 들어 있는
 * 낱말을 보고 미리 준비한 답변 하나를 고릅니다.
 */
export const MOCK_VIDEO_REVISIONS: {
  match: RegExp;
  reply: string;
  revise: (prompt: string) => string;
}[] = [
  {
    match: /어둡|어두운|밤|톤 다운|차분/,
    reply: "좋아요. 전체 조명을 낮추고 네온 반사를 강조하는 방향으로 프롬프트를 수정했어요.",
    revise: (prompt) => `${prompt} 전체 조명을 더 낮추고 네온 반사를 강조해줘.`,
  },
  {
    match: /천천|느리|속도|카메라|움직임/,
    reply: "카메라 이동을 느린 트래킹 샷으로 조정해볼게요.",
    revise: (prompt) => `${prompt} 카메라는 느린 트래킹 샷으로 천천히 움직여줘.`,
  },
  {
    match: /밝|화사|경쾌|활기/,
    reply: "분위기를 밝게 바꿔볼게요. 조명을 올리고 색을 조금 더 선명하게 했습니다.",
    revise: (prompt) => `${prompt} 조명을 밝게 올리고 색감을 선명하게 해줘.`,
  },
  {
    match: /사람|인물|주인공|얼굴/,
    reply: "인물이 더 잘 보이도록 화면 구성을 조정했어요.",
    revise: (prompt) => `${prompt} 인물이 화면 중앙에 오도록 구도를 잡아줘.`,
  },
  {
    match: /소리|음악|배경음|사운드/,
    reply: "지금 단계에서는 영상만 만들어집니다. 음악은 나중에 추가하는 편이 좋아요.",
    revise: (prompt) => prompt,
  },
];

export const MOCK_VIDEO_FALLBACK_REPLY =
  "아직 Claude가 연결되지 않아 예시 답변만 보여 드려요. 밝기, 카메라 움직임, 인물 구도처럼 바꾸고 싶은 점을 말씀해 주시면 프롬프트를 고쳐 드립니다.";

/* ------------------------------------------------------------------ */
/* CtrlAI Apps                                                         */
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
  replies?: Comment[];
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
    launchUrl: null,
    githubRepo: "yurikim/habit-at-a-glance",
    artwork: ["#3355ff", "#7c3aed"],
    reactions: { like: 24, useful: 11, interesting: 6 },
    comments: [
      {
        id: "c1",
        author: { username: "minji", displayName: "박민지", membership: "active" },
        body: "화면이 깔끔해서 사용하기 좋아요.",
        createdAt: "2026-09-14",
        replies: [
          {
            id: "c1r1",
            author: { username: "yurikim", displayName: "김유리", membership: "active" },
            body: "감사합니다. 처음엔 복잡했는데 Claude에게 더 단순하게 만들어 달라고 했어요.",
            createdAt: "2026-09-14",
          },
        ],
      },
      {
        id: "c2",
        author: { username: "seojun", displayName: "이서준", membership: "active" },
        body: "주간 통계도 추가되면 좋을 것 같아요.",
        createdAt: "2026-09-18",
        replies: [
          {
            id: "c2r1",
            author: { username: "yurikim", displayName: "김유리", membership: "active" },
            body: "지금 그래프 추가하는 중이에요. 다음 주에 다시 올려볼게요.",
            createdAt: "2026-09-19",
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
    comments: [
      {
        id: "c3",
        author: { username: "daeun", displayName: "최다은", membership: "inactive" },
        body: "회의 끝나고 바로 정리돼서 편했어요. 매주 쓰고 있습니다.",
        createdAt: "2026-09-02",
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
    comments: [
      {
        id: "c4",
        author: { username: "minji", displayName: "박민지", membership: "active" },
        body: "지난 시즌 앱이지만 아직도 잘 쓰고 있어요.",
        createdAt: "2026-07-03",
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
    comments: [],
  },
];

export function findApp(slug: string): App | undefined {
  return MOCK_APPS.find((app) => app.slug === slug);
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
  /** 실제 기록에서는 YouTube 영상 ID가 저장됩니다. */
  youtubeVideoId: string | null;
  prompt: string;
  artwork: [string, string];
  reactions: Record<ReactionType, number>;
  /** Ctrl AI에 저장되는 커뮤니티 댓글. YouTube 댓글과 섞지 않습니다. */
  comments: Comment[];
  /** 별도 영역에 따로 표시되는 YouTube 댓글 수. */
  youtubeCommentCount: number;
}

export const MOCK_VIDEOS: CommunityVideo[] = [
  {
    id: "v-seoul-rain",
    title: "비 오는 서울의 밤",
    description: "Claude로 프롬프트를 다듬고 Higgsfield로 만든 15초 영상입니다.",
    creator: { username: "yurikim", displayName: "김유리", membership: "active" },
    publishedAt: "2026-09-25",
    duration: "15초",
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
        replies: [
          {
            id: "vc1r1",
            author: { username: "yurikim", displayName: "김유리", membership: "active" },
            body: "15초에 9:16으로 만들었어요. 프롬프트는 Claude로 한 번 다듬었습니다.",
            createdAt: "2026-09-26",
          },
        ],
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
 * Claude는 토큰, 영상 생성은 크레딧으로 계산합니다. 단위가 다르므로
 * 하나의 가짜 단위로 합치지 않고 각각 따로 보여 줍니다.
 */
export interface Allocation {
  /** 제공자 이름. 서비스 이름은 영어를 유지합니다. */
  provider: string;
  /** 사용자에게 보여 줄 한국어 항목 이름. */
  label: string;
  resourceType: string;
  unit: string;
  allocated: number;
  used: number;
  note: string;
}

export const MOCK_ALLOCATIONS: Allocation[] = [
  {
    provider: "Claude",
    label: "Claude 사용량",
    resourceType: "글·대화 생성",
    unit: "토큰",
    allocated: 2_000_000,
    used: 650_000,
    note: "Chat, Project Builder 작업, 영상 프롬프트 다듬기에 사용됩니다.",
  },
  {
    provider: "Higgsfield",
    label: "영상 생성 크레딧",
    resourceType: "영상 생성",
    unit: "크레딧",
    allocated: 100,
    used: 35,
    note: "짧은 영상 한 편에 약 1크레딧이 사용됩니다.",
  },
];

export interface UsageEvent {
  date: string;
  provider: string;
  detail: string;
  quantity: string;
}

export const MOCK_USAGE_EVENTS: UsageEvent[] = [
  { date: "2026-09-27", provider: "Claude", detail: "Project Builder — 습관 한눈에", quantity: "18,400 토큰" },
  { date: "2026-09-25", provider: "Higgsfield", detail: "영상 — 비 오는 서울의 밤", quantity: "1 크레딧" },
  { date: "2026-09-25", provider: "Claude", detail: "영상 프롬프트 다듬기", quantity: "2,100 토큰" },
  { date: "2026-09-22", provider: "Claude", detail: "Chat 대화", quantity: "5,600 토큰" },
  { date: "2026-09-19", provider: "Higgsfield", detail: "영상 — 새벽 부산 해안", quantity: "1 크레딧" },
];

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export type SeasonStatus = "active" | "upcoming" | "closed";

export const SEASON_STATUS_LABEL: Record<SeasonStatus, string> = {
  active: "진행 중",
  upcoming: "예정",
  closed: "종료",
};

export interface Season {
  name: string;
  startsAt: string;
  endsAt: string;
  status: SeasonStatus;
  members: number;
}

export const MOCK_SEASONS: Season[] = [
  { name: "2026 Season 2", startsAt: "2026-07-01", endsAt: "2026-12-31", status: "active", members: 5 },
  { name: "2026 Season 1", startsAt: "2026-01-01", endsAt: "2026-06-30", status: "closed", members: 4 },
  { name: "2027 Season 1", startsAt: "2027-01-01", endsAt: "2027-06-30", status: "upcoming", members: 0 },
];

export const ROLE_LABEL: Record<"admin" | "member", string> = {
  admin: "관리자",
  member: "회원",
};

export interface AdminMember {
  username: string;
  displayName: string;
  role: "admin" | "member";
  membership: MembershipStatus;
  season: string;
  claudeTokens: number;
  videoCredits: number;
}

export const MOCK_MEMBERS: AdminMember[] = [
  {
    username: "yurikim",
    displayName: "김유리",
    role: "admin",
    membership: "active",
    season: "2026 Season 2",
    claudeTokens: 2_000_000,
    videoCredits: 100,
  },
  {
    username: "minji",
    displayName: "박민지",
    role: "member",
    membership: "active",
    season: "2026 Season 2",
    claudeTokens: 2_000_000,
    videoCredits: 100,
  },
  {
    username: "seojun",
    displayName: "이서준",
    role: "member",
    membership: "active",
    season: "2026 Season 2",
    claudeTokens: 1_000_000,
    videoCredits: 50,
  },
  {
    username: "daeun",
    displayName: "최다은",
    role: "member",
    membership: "inactive",
    season: "2026 Season 1",
    claudeTokens: 0,
    videoCredits: 0,
  },
  {
    username: "jihoon",
    displayName: "서지훈",
    role: "member",
    membership: "former",
    season: "2026 Season 1",
    claudeTokens: 0,
    videoCredits: 0,
  },
];

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

/** 사용률(%) — 사이드바와 Usage 화면이 같은 값을 쓰도록 한 곳에 둡니다. */
export function usedPercent(allocation: Allocation): number {
  if (allocation.allocated <= 0) return 0;
  return Math.min(100, Math.round((allocation.used / allocation.allocated) * 100));
}

export function totalReactions(reactions: Record<ReactionType, number>): number {
  return reactions.like + reactions.useful + reactions.interesting;
}
