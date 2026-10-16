/**
 * promo-videos — the club's intro video in the guide and on CtrlAITube.
 *
 * jsdom has no layout, media playback or fullscreen, so this proves the
 * ingredients: the guide always plays the 16:9 file and CtrlAITube always
 * the 9:16 file whatever the width (fix-promo-video-placement), nothing
 * plays by itself, sound is off until asked, the grid holds only real
 * videos (the official one, no sample cards), and reactions and comments
 * talk to the API and show the right actions for mine vs. others'. The
 * admin queue shows the report with its three actions.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { TubeVideo, TubeVideoDetail } from "@/lib/tube";

vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({
    state: { phase: "authenticated", user: { username: "yurikim", display_name: "김유리", is_admin: false } },
  }),
}));
vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMyQuarter: () => ({ state: { phase: "ready", quarter: { membership_status: "active" } } }),
}));
const toastShow = vi.fn();
vi.mock("@/app/components/ToastProvider", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/ctrlaitube",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  listTubeVideos: vi.fn(),
  getTubeVideo: vi.fn(),
  toggleTubeReaction: vi.fn(),
  addTubeComment: vi.fn(),
  editTubeComment: vi.fn(),
  deleteTubeComment: vi.fn(),
  reportTubeComment: vi.fn(),
  listTubeReports: vi.fn(),
  adminTubeComment: vi.fn(),
  resolveTubeReport: vi.fn(),
};
vi.mock("@/lib/tube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tube")>();
  return {
    ...actual,
    listTubeVideos: () => api.listTubeVideos(),
    getTubeVideo: (slug: string) => api.getTubeVideo(slug),
    toggleTubeReaction: (slug: string, kind: string) => api.toggleTubeReaction(slug, kind),
    addTubeComment: (slug: string, body: string, parent: number | null = null) => api.addTubeComment(slug, body, parent),
    editTubeComment: (id: number, body: string) => api.editTubeComment(id, body),
    deleteTubeComment: (id: number) => api.deleteTubeComment(id),
    reportTubeComment: (id: number, reason: string) => api.reportTubeComment(id, reason),
    listTubeReports: () => api.listTubeReports(),
    adminTubeComment: (id: number, action: string, reason: string) => api.adminTubeComment(id, action, reason),
    resolveTubeReport: (id: number, note: string) => api.resolveTubeReport(id, note),
  };
});
vi.mock("@/lib/apps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apps")>();
  return { ...actual, listAppReports: () => Promise.resolve([]) };
});

const { default: PromoVideo } = await import("@/app/components/PromoVideo");
const { default: VideoGrid } = await import("@/app/ctrlaitube/VideoGrid");
const { default: TubeVideoView } = await import("@/app/ctrlaitube/[id]/TubeVideoView");
const { default: AdminContentPage } = await import("@/app/admin/content/page");

const SOURCES = {
  desktop: "/promo/ctrlai-intro-desktop-v1.mp4",
  mobile: "/promo/ctrlai-intro-mobile-v1.mp4",
  posterDesktop: "/promo/ctrlai-intro-desktop-v1.jpg",
  posterMobile: "/promo/ctrlai-intro-mobile-v1.jpg",
};
const WIDE = { src: SOURCES.desktop, poster: SOURCES.posterDesktop, orientation: "wide" as const };
const TALL = { src: SOURCES.mobile, poster: SOURCES.posterMobile, orientation: "tall" as const };

function setWidth(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const OFFICIAL: TubeVideoDetail = {
  id: 1,
  slug: "ctrlai-intro",
  kind: "hosted",
  title: "CTRL+AI 한눈에 보기",
  description: "1분 안에 보는 CTRL+AI.",
  official: true,
  creator: null,
  hosted_desktop_src: SOURCES.desktop,
  hosted_mobile_src: SOURCES.mobile,
  poster_desktop_src: SOURCES.posterDesktop,
  poster_mobile_src: SOURCES.posterMobile,
  youtube_video_id: null,
  duration_seconds: 60,
  published_at: "2026-10-16T03:00:00Z",
  reactions: { like: 3, useful: 1, interesting: 0 },
  my_reactions: ["useful"],
  comment_count: 2,
  comments: [
    {
      id: 11,
      author: { username: "yurikim", display_name: "김유리", membership: "active" },
      body: "내 댓글",
      created_at: "2026-10-16T03:10:00Z",
      updated_at: "2026-10-16T03:10:00Z",
      mine: true,
      replies: [],
    },
    {
      id: 12,
      author: { username: "minji", display_name: "박민지", membership: "active" },
      body: "남의 댓글",
      created_at: "2026-10-16T03:20:00Z",
      updated_at: "2026-10-16T03:20:00Z",
      mine: false,
      replies: [],
    },
  ],
};

beforeEach(() => {
  setWidth(true);
  toastShow.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.listTubeVideos.mockResolvedValue([OFFICIAL as TubeVideo]);
  api.getTubeVideo.mockResolvedValue(OFFICIAL);
  api.listTubeReports.mockResolvedValue([]);
});

describe("PromoVideo", () => {
  test("받은 편을 그대로 틀고 (너비와 상관없이), 저절로 재생하지 않는다", () => {
    setWidth(false); // a phone width changes nothing
    const { unmount } = render(<PromoVideo clip={WIDE} title="소개" />);
    let video = document.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(SOURCES.desktop);
    expect(video.getAttribute("poster")).toBe(SOURCES.posterDesktop);
    expect(video.getAttribute("data-orientation")).toBe("wide");
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.getAttribute("preload")).toBe("metadata");
    unmount();

    setWidth(true); // a desktop width changes nothing either
    render(<PromoVideo clip={TALL} title="소개" />);
    video = document.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(SOURCES.mobile);
    expect(video.getAttribute("data-orientation")).toBe("tall");
  });

  test("소리는 꺼진 채 시작하고 '소리 켜기'로 켠다; '크게 보기'는 전체 화면을 요청한다", async () => {
    const user = userEvent.setup();
    render(<PromoVideo clip={WIDE} title="소개" />);
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.muted).toBe(true);

    await user.click(screen.getByRole("button", { name: "소리 켜기" }));
    expect(video.muted).toBe(false);
    expect(screen.getByRole("button", { name: "소리 끄기" }).getAttribute("aria-pressed")).toBe("true");

    const fullscreen = vi.fn().mockResolvedValue(undefined);
    video.requestFullscreen = fullscreen;
    await user.click(screen.getByRole("button", { name: "크게 보기" }));
    expect(fullscreen).toHaveBeenCalledTimes(1);
  });
});

describe("CtrlAITube 목록", () => {
  test("공식 영상 카드만 있고 (예시 카드 없음), 세로 포스터와 저장된 반응·댓글 수", async () => {
    render(<VideoGrid />);
    const card = await screen.findByTestId("official-card");
    expect(card.getAttribute("href")).toBe("/ctrlaitube/ctrlai-intro");
    expect(card.textContent).toContain("CTRL+AI 한눈에 보기");
    expect(card.textContent).toContain("공식");
    expect(card.textContent).toContain("1:00");
    expect(within(card).getByText("4")).toBeTruthy(); // 3 + 1 + 0
    expect(within(card).getByText("2")).toBeTruthy();
    expect(card.querySelector("img")?.getAttribute("src")).toBe(SOURCES.posterMobile);
    // Nothing else: the sample cards are gone.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("비 오는 서울의 밤")).toBeNull();
  });

  test("영상이 없으면 빈 상태를 보여 준다", async () => {
    api.listTubeVideos.mockResolvedValue([]);
    render(<VideoGrid />);
    expect(await screen.findByText("아직 영상이 없어요.")).toBeTruthy();
  });
});

describe("공식 영상 화면", () => {
  test("반응을 누르면 서버에 켜고 끄고, 내 댓글에는 고치기·지우기, 남의 댓글에는 신고", async () => {
    const user = userEvent.setup();
    api.toggleTubeReaction.mockResolvedValue({ kind: "like", on: true, reactions: { like: 4, useful: 1, interesting: 0 } });
    render(<TubeVideoView slug="ctrlai-intro" />);

    expect(await screen.findByRole("heading", { level: 1, name: /CTRL\+AI 한눈에 보기/ })).toBeTruthy();
    expect(screen.getByText("공식")).toBeTruthy();
    // CtrlAITube plays the 9:16 file even at a desktop width.
    expect((document.querySelector("video") as HTMLVideoElement).getAttribute("src")).toBe(SOURCES.mobile);
    expect(screen.getByText("9:16 세로")).toBeTruthy();

    // Counts come from the server; my pressed state too.
    const useful = screen.getByRole("button", { name: /유용해요/ });
    expect(useful.getAttribute("aria-pressed")).toBe("true");
    expect(useful.textContent).toContain("1");
    await user.click(screen.getByRole("button", { name: /좋아요/ }));
    expect(api.toggleTubeReaction).toHaveBeenCalledWith("ctrlai-intro", "like");
    await waitFor(() => expect(api.getTubeVideo).toHaveBeenCalledTimes(2));

    const mine = screen.getByText("내 댓글").closest("article")!;
    expect(within(mine).getByRole("button", { name: "고치기" })).toBeTruthy();
    expect(within(mine).getByRole("button", { name: "지우기" })).toBeTruthy();
    expect(within(mine).queryByRole("button", { name: "신고" })).toBeNull();
    const theirs = screen.getByText("남의 댓글").closest("article")!;
    expect(within(theirs).getByRole("button", { name: "신고" })).toBeTruthy();
    expect(within(theirs).queryByRole("button", { name: "고치기" })).toBeNull();
    // No mock note, no per-comment 공감 (not stored yet).
    expect(screen.queryByText(/저장되지 않습니다/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^공감/ })).toBeNull();
  });

  test("댓글을 쓰면 서버에 올리고, 신고는 이유를 받아 보낸다", async () => {
    const user = userEvent.setup();
    api.addTubeComment.mockResolvedValue(OFFICIAL.comments[0]);
    api.reportTubeComment.mockResolvedValue({ detail: "신고를 받았어요. 관리자가 확인할게요." });
    render(<TubeVideoView slug="ctrlai-intro" />);
    await screen.findByText("남의 댓글");

    await user.type(screen.getByLabelText("댓글을 남겨보세요"), "좋은 영상이에요{Enter}");
    expect(api.addTubeComment).toHaveBeenCalledWith("ctrlai-intro", "좋은 영상이에요", null);

    const theirs = screen.getByText("남의 댓글").closest("article")!;
    await user.click(within(theirs).getByRole("button", { name: "신고" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/이유/), "광고");
    await user.click(within(dialog).getByRole("button", { name: "신고하기" }));
    await waitFor(() => expect(api.reportTubeComment).toHaveBeenCalledWith(12, "광고"));
    expect(toastShow).toHaveBeenCalledWith("신고를 받았어요. 관리자가 확인할게요.");
  });
});

describe("Admin › Content", () => {
  test("영상 댓글 신고가 표에 뜨고, 숨기기·지우기·닫기가 붙는다", async () => {
    api.listTubeReports.mockResolvedValue([
      {
        id: 7,
        comment_id: 12,
        video_slug: "ctrlai-intro",
        video_title: "CTRL+AI 한눈에 보기",
        reason: "광고",
        excerpt: "남의 댓글",
        reporter_username: "yurikim",
        author_username: "minji",
        created_at: new Date().toISOString(),
        comment_live: true,
      },
    ]);
    render(<AdminContentPage />);
    const table = await screen.findByTestId("tube-reports");
    const row = within(table).getAllByRole("row")[1];
    expect(row.textContent).toContain("CTRL+AI 한눈에 보기");
    expect(row.textContent).toContain("남의 댓글");
    expect(row.textContent).toContain("minji");
    expect(within(row).getByRole("button", { name: "댓글 숨기기" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "댓글 지우기" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "신고 닫기" })).toBeTruthy();
  });
});
