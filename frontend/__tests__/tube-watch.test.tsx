/**
 * CtrlAITube 재생 화면.
 *
 * 이 화면이 고치려는 문제는 **100% 배율에서 제목부터 아래가 화면 밖으로
 * 밀려나는 것**이었습니다. 영상이 폭을 가득 채우고, 반응과 댓글이 그
 * 아래에 쌓여 있었기 때문입니다.
 *
 * 밀려남 자체는 **jsdom에서 증명할 수 없습니다** — 레이아웃 엔진이 없어
 * 모든 상자의 크기가 0입니다. 그래서 여기서는 크기를 정하는 *재료*가
 * 맞게 들어가는지만 봅니다: 재생 틀이 레터박스 칸 안에 있고, 영상의
 * 비율이 `--player-ar`로 전달되는지. 실제로 밀려나지 않는지는 브라우저에서
 * 세 가지 비율과 세 가지 폭으로 확인했고, 그 방법은 docs/BACKLOG.md에
 * 적어 두었습니다. Video Generator 미리보기 테스트와 같은 한계입니다.
 *
 * 나머지(반응 토글, 정렬, 탭, 접히는 실타래, Enter로 등록)는 눌러서
 * 결과를 볼 수 있는 것이므로 여기서 제대로 증명됩니다.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { Comment, CommunityVideo } from "@/lib/mock-data";

// 로그인한 회원. 댓글을 쓰는 사람이고, 꼬리표는 이번 분기 참여 기록에서
// 옵니다.
vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({
    state: {
      phase: "authenticated",
      user: { username: "yurikim", display_name: "김유리", is_admin: false },
    },
  }),
}));

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMyQuarter: () => ({ state: { phase: "ready", quarter: { membership_status: "active" } } }),
}));

// CSS 모듈은 jsdom에서 이름만 돌려 줍니다. 클래스 이름으로 찾을 수 있게
// 키를 그대로 값으로 씁니다.
vi.mock("@/app/ctrlaitube/[id]/watch.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// 반응 칩·탭·댓글칸은 CtrlAIApps와 함께 쓰는 공용 컴포넌트에서 옵니다.
vi.mock("@/app/components/comment-section.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

const { default: WatchPanel } = await import("@/app/ctrlaitube/[id]/WatchPanel");
const { default: VideoDetailPage } = await import("@/app/ctrlaitube/[id]/page");

/* ------------------------------------------------------------------ */
/* 예시 데이터                                                          */
/* ------------------------------------------------------------------ */

function comment(id: string, body: string, likes: number, replies?: Comment[]): Comment {
  return {
    id,
    author: { username: "minji", displayName: "박민지", membership: "active" },
    body,
    createdAt: "2026-09-26",
    likes,
    replies,
  };
}

function video(overrides: Partial<CommunityVideo> = {}): CommunityVideo {
  return {
    id: "v-test",
    title: "비 오는 서울의 밤",
    description: "15초 영상입니다.",
    creator: { username: "yurikim", displayName: "김유리", membership: "active" },
    publishedAt: "2026-09-25",
    duration: "15초",
    aspectRatio: "9:16",
    youtubeVideoId: null,
    prompt: "비 오는 밤 서울",
    artwork: ["#1e1b4b", "#7c3aed"],
    reactions: { like: 86, useful: 5, interesting: 31 },
    comments: [],
    youtubeCommentCount: 12,
    ...overrides,
  };
}

/** 그려진 댓글(답글 제외)을 적힌 순서대로. */
function commentTexts(): string[] {
  return Array.from(document.querySelectorAll(".comment")).map(
    (el) => el.querySelector(".commentText")?.textContent ?? "",
  );
}

function chip(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(name) });
}

/* ------------------------------------------------------------------ */
/* 재생 틀                                                              */
/* ------------------------------------------------------------------ */

describe("재생 틀", () => {
  test.each([
    ["9:16", "9 / 16"],
    ["16:9", "16 / 9"],
    ["1:1", "1 / 1"],
  ])("%s 영상은 레터박스 칸 안에 그 비율로 들어간다", async (aspect, ratio) => {
    // MOCK_VIDEOS에 세 비율이 모두 들어 있어야 이 화면을 눈으로도 확인할
    // 수 있습니다. 여기서는 그 데이터가 아니라 화면이 비율을 어떻게
    // 쓰는지를 봅니다.
    const { MOCK_VIDEOS } = await import("@/lib/mock-data");
    const sample = MOCK_VIDEOS.find((v) => v.aspectRatio === aspect);
    expect(sample, `${aspect} 예시 영상이 없습니다`).toBeDefined();

    render(await VideoDetailPage({ params: Promise.resolve({ id: sample!.id }) }));

    const player = document.querySelector(".player") as HTMLElement;
    expect(player).not.toBeNull();

    // 1. 영상은 레터박스 칸 안에 있습니다. 칸이 높이를 75vh로 묶고, 영상은
    //    그 안에서만 커집니다 — 이것이 제목이 밀려나지 않는 이유입니다.
    expect(player.parentElement?.className).toContain("playerFrame");

    // 2. 비율은 영상이 들고 있는 값 그대로 전달됩니다. 값은 칸에만 붙이고
    //    안쪽 영상은 물려받습니다 — CSS 변수는 상속되므로, 두 곳이 어긋날
    //    수 없게 한 번만 적습니다. 칸은 이 값으로 높이를, 영상은 너비를
    //    정합니다.
    expect(player.parentElement?.style.getPropertyValue("--player-ar")).toBe(ratio);
  });

  test("제목과 만든 사람은 영상 바로 아래 한 줄에 있다", async () => {
    render(await VideoDetailPage({ params: Promise.resolve({ id: "v-seoul-rain" }) }));

    // 예전에는 여섯 줄 표가 이 자리를 차지했습니다.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("비 오는 서울의 밤");
    expect(screen.getByText("9:16 세로")).toBeDefined();
    expect(document.querySelector(".detailRows")).toBeNull();
  });

  test("자세히는 댓글칸보다 뒤에 적힌다", async () => {
    // 좁은 화면에서 적힌 순서대로 쌓이므로, 순서가 곧 배치입니다.
    render(await VideoDetailPage({ params: Promise.resolve({ id: "v-seoul-rain" }) }));

    const panel = document.querySelector(".panel");
    const extra = document.querySelector(".extra");
    expect(panel).not.toBeNull();
    expect(extra).not.toBeNull();
    expect(panel!.compareDocumentPosition(extra!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* 반응                                                                */
/* ------------------------------------------------------------------ */

describe("반응", () => {
  test("누르면 수가 하나 오르고, 다시 누르면 되돌아온다", async () => {
    const user = userEvent.setup();
    render(<WatchPanel video={video()} />);

    const like = chip("좋아요");
    expect(like.getAttribute("aria-pressed")).toBe("false");
    expect(like.textContent).toContain("86");

    await user.click(like);
    expect(chip("좋아요").getAttribute("aria-pressed")).toBe("true");
    expect(chip("좋아요").textContent).toContain("87");

    await user.click(chip("좋아요"));
    expect(chip("좋아요").getAttribute("aria-pressed")).toBe("false");
    expect(chip("좋아요").textContent).toContain("86");
  });

  test("반응 하나를 눌러도 다른 반응은 그대로다", async () => {
    const user = userEvent.setup();
    render(<WatchPanel video={video()} />);

    await user.click(chip("좋아요"));

    expect(chip("유용해요").getAttribute("aria-pressed")).toBe("false");
    expect(chip("유용해요").textContent).toContain("5");
  });
});

/* ------------------------------------------------------------------ */
/* 탭 — 두 가지 댓글은 섞이지 않습니다                                  */
/* ------------------------------------------------------------------ */

describe("탭", () => {
  test("CTRL+AI 댓글 수는 답글까지 센다", () => {
    render(
      <WatchPanel
        video={video({
          comments: [
            comment("c1", "첫 댓글", 1, [comment("c1r1", "답글", 0)]),
            comment("c2", "둘", 0),
          ],
        })}
      />,
    );

    // 댓글 2개 + 답글 1개.
    expect(screen.getByRole("tab", { name: "CTRL+AI 댓글 3" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "YouTube 댓글 12" })).toBeDefined();
  });

  test("YouTube 탭으로 바꾸면 CTRL+AI 댓글은 사라진다", async () => {
    const user = userEvent.setup();
    render(<WatchPanel video={video({ comments: [comment("c1", "커뮤니티 댓글", 0)] })} />);

    expect(screen.getByText("커뮤니티 댓글")).toBeDefined();

    await user.click(screen.getByRole("tab", { name: /YouTube 댓글/ }));

    // 섞이지 않는다는 것이 이 탭의 존재 이유입니다.
    expect(screen.queryByText("커뮤니티 댓글")).toBeNull();
    expect(screen.getByText(/YouTube 채널에 댓글 12개/)).toBeDefined();
    expect(screen.getByRole("button", { name: "YouTube에서 보기" })).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* 정렬                                                                */
/* ------------------------------------------------------------------ */

describe("정렬", () => {
  test("인기순은 공감이 많은 댓글을 먼저 보여 준다", async () => {
    const user = userEvent.setup();
    render(
      <WatchPanel
        video={video({
          comments: [
            { ...comment("c1", "공감 적은 댓글", 1), createdAt: "2026-09-30" },
            { ...comment("c2", "공감 많은 댓글", 9), createdAt: "2026-09-20" },
          ],
        })}
      />,
    );

    // 최신순이 기본입니다.
    expect(commentTexts()).toEqual(["공감 적은 댓글", "공감 많은 댓글"]);

    await user.click(screen.getByRole("button", { name: "인기순" }));
    expect(commentTexts()).toEqual(["공감 많은 댓글", "공감 적은 댓글"]);

    await user.click(screen.getByRole("button", { name: "최신순" }));
    expect(commentTexts()).toEqual(["공감 적은 댓글", "공감 많은 댓글"]);
  });
});

/* ------------------------------------------------------------------ */
/* 긴 실타래                                                            */
/* ------------------------------------------------------------------ */

describe("답글", () => {
  test("답글이 셋을 넘으면 접히고, 눌러서 펼친다", async () => {
    const user = userEvent.setup();
    const replies = [1, 2, 3, 4].map((n) => comment(`r${n}`, `답글 ${n}`, 0));
    render(<WatchPanel video={video({ comments: [comment("c1", "본 댓글", 0, replies)] })} />);

    expect(screen.queryByText("답글 1")).toBeNull();

    await user.click(screen.getByRole("button", { name: "답글 4개 보기" }));

    expect(screen.getByText("답글 1")).toBeDefined();
    expect(screen.getByText("답글 4")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "답글 숨기기" }));
    expect(screen.queryByText("답글 1")).toBeNull();
  });

  test("셋 이하인 실타래는 그대로 보인다", () => {
    const replies = [1, 2].map((n) => comment(`r${n}`, `답글 ${n}`, 0));
    render(<WatchPanel video={video({ comments: [comment("c1", "본 댓글", 0, replies)] })} />);

    expect(screen.getByText("답글 1")).toBeDefined();
    expect(screen.queryByRole("button", { name: /답글 \d+개 보기/ })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 입력칸                                                              */
/* ------------------------------------------------------------------ */

describe("댓글 쓰기", () => {
  test("비어 있으면 등록할 수 없다", async () => {
    const user = userEvent.setup();
    render(<WatchPanel video={video()} />);

    const submit = screen.getByRole("button", { name: "등록" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByLabelText("댓글을 남겨보세요"), "좋은 영상이에요");
    expect(screen.getByRole("button", { name: "등록" }).hasAttribute("disabled")).toBe(false);
  });

  test("공백만 적어도 등록할 수 없다", async () => {
    const user = userEvent.setup();
    render(<WatchPanel video={video()} />);

    await user.type(screen.getByLabelText("댓글을 남겨보세요"), "   ");
    expect(screen.getByRole("button", { name: "등록" }).hasAttribute("disabled")).toBe(true);
  });

  test("Enter로 등록되고, 쓴 글은 목록에 올라간다", async () => {
    const user = userEvent.setup();
    render(<WatchPanel video={video()} />);

    const field = screen.getByLabelText("댓글을 남겨보세요");
    await user.type(field, "젖은 도로가 예뻐요{Enter}");

    expect(screen.getByText("젖은 도로가 예뻐요")).toBeDefined();
    // 입력칸은 비워집니다.
    expect((field as HTMLTextAreaElement).value).toBe("");
    // 쓴 사람은 로그인한 회원입니다.
    const posted = document.querySelector(".comment") as HTMLElement;
    expect(within(posted).getByText("김유리")).toBeDefined();
    expect(within(posted).getByText("방금 전")).toBeDefined();
  });

  test("Shift+Enter는 줄을 바꾸고 등록하지 않는다", async () => {
    const user = userEvent.setup();
    render(<WatchPanel video={video()} />);

    const field = screen.getByLabelText("댓글을 남겨보세요") as HTMLTextAreaElement;
    await user.type(field, "첫 줄{Shift>}{Enter}{/Shift}둘째 줄");

    expect(field.value).toBe("첫 줄\n둘째 줄");
    expect(document.querySelector(".comment")).toBeNull();
  });

  test("한글 조합 중의 Enter로는 등록되지 않는다", async () => {
    // 한글은 조합 중에도 Enter가 들어옵니다. 그때 올려 버리면 마지막
    // 글자가 잘린 댓글이 등록됩니다.
    const user = userEvent.setup();
    render(<WatchPanel video={video()} />);

    const field = screen.getByLabelText("댓글을 남겨보세요") as HTMLTextAreaElement;
    await user.type(field, "안녕하세요");

    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
    );

    expect(document.querySelector(".comment")).toBeNull();
    expect(field.value).toBe("안녕하세요");

    // 조합이 끝난 Enter는 올립니다.
    await user.type(field, "{Enter}");
    expect(screen.getByText("안녕하세요")).toBeDefined();
  });

  test("답글을 달면 그 댓글 아래에 붙는다", async () => {
    const user = userEvent.setup();
    render(<WatchPanel video={video({ comments: [comment("c1", "본 댓글", 0)] })} />);

    await user.click(screen.getByRole("button", { name: "답글" }));

    const replyField = screen.getByLabelText("박민지님에게 답글 쓰기");
    await user.type(replyField, "저도 그렇게 생각해요{Enter}");

    const thread = document.querySelector(".replies") as HTMLElement;
    expect(thread).not.toBeNull();
    expect(within(thread).getByText("저도 그렇게 생각해요")).toBeDefined();
    // 답글도 전체 댓글 수에 들어갑니다.
    expect(screen.getByRole("tab", { name: "CTRL+AI 댓글 2" })).toBeDefined();
  });

  test("저장되지 않는다는 사실을 적어 둔다", () => {
    render(<WatchPanel video={video()} />);
    expect(screen.getByText(/댓글 기능은 아직 준비 중입니다/)).toBeDefined();
  });
});
