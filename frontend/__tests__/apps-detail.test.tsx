/**
 * CtrlAIApps 앱 상세 화면.
 *
 * 이 화면이 고치려는 문제 가운데 테스트로 **증명할 수 있는 것**은 버튼의
 * 상태입니다. 예전에는 넷 중 어느 앱에도 실행 주소가 없는데 앱 실행
 * 버튼이 네 번 모두 같은 모양으로 있었습니다. 눌릴 것처럼 보이는 버튼은
 * 눌러 보고 나서야 아무 일도 일어나지 않는다는 것을 알려 줍니다.
 *
 * 배치(히어로가 두 칸인지, 좁은 화면에서 쌓이는지)는 **jsdom에서 볼 수
 * 없습니다** — 레이아웃 엔진이 없어 모든 상자가 0입니다. 그쪽은
 * 브라우저에서 확인하고 docs/BACKLOG.md에 적어 둡니다. 여기서는 눌러서
 * 결과를 볼 수 있는 것만 봅니다.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

// 댓글을 쓰는 사람. 공용 댓글칸이 로그인한 회원을 읽습니다.
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
vi.mock("@/app/ctrlaistore/ctrlaistore.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

vi.mock("@/app/components/comment-section.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

const { default: AppDetailPage } = await import("@/app/ctrlaistore/[slug]/page");
const { default: AppTabs } = await import("@/app/ctrlaistore/[slug]/AppTabs");
const { MOCK_APPS, findApp, totalComments } = await import("@/lib/mock-data");

function openPage(slug: string) {
  return AppDetailPage({ params: Promise.resolve({ slug }) });
}

/** 실행 주소가 있는 앱과 없는 앱. 둘 다 예시에 있어야 합니다. */
const withLaunch = MOCK_APPS.find((app) => app.launchUrl !== null);
const withoutLaunch = MOCK_APPS.find((app) => app.launchUrl === null);

/* ------------------------------------------------------------------ */
/* 앱 실행                                                             */
/* ------------------------------------------------------------------ */

describe("앱 실행", () => {
  test("예시에는 실행 주소가 있는 앱과 없는 앱이 모두 있다", () => {
    // 둘 중 하나가 없으면 아래 두 테스트 가운데 하나는 아무것도 보지
    // 못한 채로 통과합니다.
    expect(withLaunch, "실행 주소가 있는 예시 앱이 없습니다").toBeDefined();
    expect(withoutLaunch, "실행 주소가 없는 예시 앱이 없습니다").toBeDefined();
  });

  test("실행 주소가 없으면 누를 수 없고, 왜 그런지 적혀 있다", async () => {
    render(await openPage(withoutLaunch!.slug));

    const button = screen.getByRole("button", { name: "실행 준비 중" });
    expect(button.hasAttribute("disabled")).toBe(true);
    // 가리키면 이유가 나옵니다. 막아 두고 이유를 적지 않으면 고장과
    // 구별되지 않습니다.
    expect(button.getAttribute("title")).toContain("실행 주소");

    // 누를 수 있는 앱 실행 버튼은 없습니다.
    expect(screen.queryByRole("link", { name: "앱 실행" })).toBeNull();
    expect(screen.queryByRole("button", { name: "앱 실행" })).toBeNull();
  });

  test("실행 주소가 있으면 그 주소로 열린다", async () => {
    render(await openPage(withLaunch!.slug));

    const launch = screen.getByRole("link", { name: "앱 실행" });
    expect(launch.getAttribute("href")).toBe(withLaunch!.launchUrl);
    // 회원이 만든 앱은 CTRL+AI가 아니므로 새 탭에서 엽니다.
    expect(launch.getAttribute("target")).toBe("_blank");
    expect(launch.getAttribute("rel")).toContain("noreferrer");
    expect(screen.queryByRole("button", { name: "실행 준비 중" })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 히어로                                                              */
/* ------------------------------------------------------------------ */

describe("히어로", () => {
  test("이름과 만든 사람이 먼저 오고, 큰 표는 없다", async () => {
    const app = findApp("habit-at-a-glance")!;
    render(await openPage(app.slug));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(app.name);
    expect(screen.getByText(app.creator.displayName)).toBeDefined();
    expect(screen.getByText("활동 회원")).toBeDefined();
    // 분류 · 게시일 · 반응 수 한 줄이 네 줄짜리 표를 대신합니다.
    expect(document.querySelector(".detailRows")).toBeNull();
    expect(screen.getByText(`반응 ${app.reactions.like + app.reactions.useful + app.reactions.interesting}`)).toBeDefined();
  });

  test("만든 사람의 분기 사정을 설명하지 않는다", async () => {
    // 꼬리표가 이미 말하고 있고, 보는 사람이 알아야 할 것은 누가
    // 만들었는지입니다.
    render(await openPage("habit-at-a-glance"));
    expect(screen.queryByText(/이번 분기에 참여/)).toBeNull();
  });

  test("개발자 보기 버튼은 없다", async () => {
    render(await openPage("habit-at-a-glance"));
    expect(screen.queryByRole("button", { name: "개발자 보기" })).toBeNull();
  });

  test("GitHub 버튼은 저장소를 공개한 앱에만 있다", async () => {
    const open = findApp("habit-at-a-glance")!;
    const closed = findApp("meeting-notes")!;
    expect(open.githubRepo).not.toBeNull();
    expect(closed.githubRepo).toBeNull();

    const { unmount } = render(await openPage(open.slug));
    expect(screen.getByRole("button", { name: "GitHub에서 보기" })).toBeDefined();
    unmount();

    render(await openPage(closed.slug));
    expect(screen.queryByRole("button", { name: "GitHub에서 보기" })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 탭                                                                  */
/* ------------------------------------------------------------------ */

describe("탭", () => {
  test("소개가 먼저 보이고, 댓글 수는 답글까지 센다", async () => {
    const app = findApp("habit-at-a-glance")!;
    render(await openPage(app.slug));

    expect(screen.getByRole("tab", { name: "소개" }).getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("tab", { name: `댓글 ${totalComments(app.comments)}` }),
    ).toBeDefined();
    expect(screen.getByText(app.description)).toBeDefined();
  });

  test("댓글 탭은 재생 화면과 같은 댓글칸을 쓴다", async () => {
    const user = userEvent.setup();
    render(await openPage("habit-at-a-glance"));

    await user.click(screen.getByRole("tab", { name: /댓글/ }));

    // 반응 칩, 정렬, 그리고 자랄 수 있는 입력칸 — CtrlAITube와 같은 것들.
    expect(screen.getByRole("button", { name: /좋아요/ })).toBeDefined();
    expect(screen.getByRole("button", { name: "인기순" })).toBeDefined();
    expect(screen.getByLabelText("댓글을 남겨보세요")).toBeDefined();
    expect(screen.getByText(/댓글 기능은 아직 준비 중입니다/)).toBeDefined();
  });

  test("댓글을 쓰면 탭의 수도 같이 늘어난다", async () => {
    const user = userEvent.setup();
    const app = findApp("habit-at-a-glance")!;
    const before = totalComments(app.comments);
    render(await openPage(app.slug));

    await user.click(screen.getByRole("tab", { name: /댓글/ }));
    await user.type(screen.getByLabelText("댓글을 남겨보세요"), "잘 쓰고 있어요{Enter}");

    expect(screen.getByText("잘 쓰고 있어요")).toBeDefined();
    expect(screen.getByRole("tab", { name: `댓글 ${before + 1}` })).toBeDefined();
  });

  test("업데이트 기록은 판마다 한 칸씩 쌓인다", async () => {
    const user = userEvent.setup();
    const app = findApp("habit-at-a-glance")!;
    render(await openPage(app.slug));

    await user.click(screen.getByRole("tab", { name: "업데이트 기록" }));

    expect(document.querySelectorAll(".entry")).toHaveLength(app.updates.length);
    expect(screen.getByText(app.updates[0].title)).toBeDefined();
    expect(screen.getByText(app.updates[0].changes[0])).toBeDefined();
  });

  test("탭을 바꾸면 앞 탭의 내용은 사라진다", async () => {
    const user = userEvent.setup();
    const app = findApp("habit-at-a-glance")!;
    render(await openPage(app.slug));

    expect(screen.getByText(app.description)).toBeDefined();

    await user.click(screen.getByRole("tab", { name: "업데이트 기록" }));
    expect(screen.queryByText(app.description)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 같은 회원의 다른 앱                                                  */
/* ------------------------------------------------------------------ */

describe("다른 앱", () => {
  test("같은 회원의 다른 앱만 모으고, 보고 있는 앱은 빼 둔다", async () => {
    render(await openPage("habit-at-a-glance"));

    const section = document.querySelector(".others") as HTMLElement;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("김유리의 다른 앱");
    expect(section.textContent).toContain("주간 회고");
    expect(section.textContent).not.toContain("습관 한눈에");
  });

  test("곁들이 카드는 목록 화면의 큰 카드가 아니다", async () => {
    // 같은 `.card`를 쓰던 때는 이 줄이 히어로만큼 커서 본문보다 눈에
    // 먼저 들어왔습니다. 작은 가로 카드로 바꾼 것이 요점이므로, 큰
    // 카드로 되돌아가면 테스트가 깨져야 합니다.
    render(await openPage("habit-at-a-glance"));

    const section = document.querySelector(".others") as HTMLElement;
    expect(section.querySelectorAll(".otherCard")).toHaveLength(1);
    expect(section.querySelector(".card")).toBeNull();
    expect(section.querySelector(".otherThumb")).not.toBeNull();
  });

  test("다른 앱이 없으면 그 자리는 비워 둔다", async () => {
    // 서지훈은 앱이 하나뿐입니다. "다른 앱 0개"를 적는 것보다 아무것도
    // 적지 않는 편이 낫습니다.
    render(await openPage("recipe-box"));
    expect(document.querySelector(".others")).toBeNull();
  });
});


/* ------------------------------------------------------------------ */
/* 소개 탭의 세 칸                                                      */
/* ------------------------------------------------------------------ */

describe("소개", () => {
  test("주요 기능은 설명 한 줄과 함께 카드로 선다", async () => {
    // 예전에는 "투표 만들기", "결과 보기"처럼 이름만 줄줄이 적혀 있어
    // 이미 아는 사람만 알아볼 수 있었습니다. 설명이 함께 있어야
    // 처음 보는 사람도 쓸모를 판단할 수 있습니다.
    const app = findApp("team-poll")!;
    render(await openPage(app.slug));

    expect(screen.getByRole("heading", { name: "주요 기능" })).toBeDefined();
    expect(document.querySelectorAll(".feature")).toHaveLength(app.features.length);
    expect(screen.getByText(app.features[0].title)).toBeDefined();
    expect(screen.getByText(app.features[0].description)).toBeDefined();
  });

  test("화면은 눌러서 크게 볼 수 있고, Esc로 닫힌다", async () => {
    const user = userEvent.setup();
    const app = findApp("team-poll")!;
    render(await openPage(app.slug));

    // div에 onClick만 달면 키보드로 닿지 않으므로 단추여야 합니다.
    const first = screen.getByRole("button", { name: app.screenshots[0].label });
    expect(document.querySelector(".lightbox")).toBeNull();

    await user.click(first);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe(app.screenshots[0].label);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("자세히는 네 줄을 접어 둔다", async () => {
    const app = findApp("habit-at-a-glance")!;
    render(await openPage(app.slug));

    const rows = document.querySelectorAll(".detailRow");
    expect(rows).toHaveLength(4);
    expect(screen.getByText("저장소")).toBeDefined();
    expect(screen.getByText(app.githubRepo!)).toBeDefined();
    expect(screen.getByText("실행 주소")).toBeDefined();
    expect(screen.getByText("마지막 업데이트")).toBeDefined();
    expect(screen.getByText("분류")).toBeDefined();
    // 분류와 게시일은 히어로에도 있지만, 여기 있는 것은 마지막
    // **업데이트**이지 게시일이 아닙니다.
    expect(screen.getByText("2026.09.28")).toBeDefined();
  });

  test("실행 주소가 없으면 자세히에도 그렇게 적는다", async () => {
    render(await openPage("team-poll"));
    expect(screen.getByText("아직 없습니다")).toBeDefined();
    expect(screen.getByText("공개하지 않음")).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* 업데이트 타임라인                                                    */
/* ------------------------------------------------------------------ */

describe("업데이트 타임라인", () => {
  test("판 번호와 날짜와 바뀐 것이 각각 제 자리에 선다", async () => {
    const user = userEvent.setup();
    const app = findApp("team-poll")!;
    render(await openPage(app.slug));

    await user.click(screen.getByRole("tab", { name: "업데이트 기록" }));

    const entries = document.querySelectorAll(".entry");
    expect(entries).toHaveLength(app.updates.length);

    const newest = entries[0];
    expect(newest.querySelector(".entryVersion")?.textContent).toBe(app.updates[0].version);
    // 날짜와 글이 한 덩어리로 붙어 있던 것이 이 화면의 원래 문제였습니다.
    // 날짜는 제 칸에 혼자 들어 있어야 합니다.
    expect(newest.querySelector(".entryDate")?.textContent).toBe("2026.09.30");
    expect(newest.querySelector(".entryTitle")?.textContent).toBe(app.updates[0].title);
    expect(newest.querySelectorAll(".entryChange")).toHaveLength(
      app.updates[0].changes.length,
    );
  });

  test("최신 꼬리표는 맨 위 하나에만 붙는다", async () => {
    const user = userEvent.setup();
    render(await openPage("team-poll"));

    await user.click(screen.getByRole("tab", { name: "업데이트 기록" }));

    const latest = document.querySelectorAll(".entryLatest");
    expect(latest).toHaveLength(1);
    expect(document.querySelectorAll(".entry")[0].contains(latest[0])).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 비어 있을 때                                                         */
/* ------------------------------------------------------------------ */

describe("빈 자리", () => {
  test("기능도 화면도 없는 앱은 빈 칸 대신 한 줄을 보여 준다", async () => {
    // 단어 카드는 방금 게시해 아직 아무것도 올리지 않은 앱입니다.
    const app = findApp("word-cards")!;
    expect(app.features).toHaveLength(0);
    expect(app.screenshots).toHaveLength(0);

    render(await openPage(app.slug));

    expect(screen.getByText("만든 사람이 아직 기능 설명을 올리지 않았습니다.")).toBeDefined();
    expect(screen.getByText("아직 올라온 화면이 없습니다.")).toBeDefined();
    // 칸 이름은 남습니다 — 없어지면 무엇이 비었는지 알 수 없습니다.
    expect(screen.getByRole("heading", { name: "주요 기능" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "스크린샷" })).toBeDefined();
  });

  test("업데이트 기록이 하나도 없으면 그렇게 적는다", async () => {
    // 예시 앱은 모두 게시 기록을 하나씩 가지고 있으므로, 이 경우는
    // 탭에 직접 빈 목록을 건네어 봅니다.
    const user = userEvent.setup();
    const app = { ...findApp("word-cards")!, updates: [] };
    render(<AppTabs app={app} />);

    await user.click(screen.getByRole("tab", { name: "업데이트 기록" }));

    expect(screen.getByText("아직 업데이트 기록이 없습니다.")).toBeDefined();
    expect(document.querySelector(".timeline")).toBeNull();
  });
});
