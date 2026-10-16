/**
 * ui-friendly-motion — 친근한 화면과 짧은 움직임.
 *
 * 증명하는 것(스펙의 테스트 목록):
 *   - 움직임 줄이기를 켜면 움직임이 없다: CSS 규칙이 있고, 잔액 숫자는 세지
 *     않고 바로 바뀐다.
 *   - 첫 안내는 한 번만 뜨고, 다시 열 수 있다.
 *   - 빈 목록은 설명과 할 일 하나를 보여 준다.
 * 그리고 불러오는 막대, 알림, 쉬운 말(작성 중)을 확인합니다.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getMyUsage = vi.fn();
vi.mock("@/lib/quarters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quarters")>();
  return { ...actual, getMyUsage: () => getMyUsage() };
});

import { MotionGlobalConfig } from "motion/react";

import AnimatedNumber from "@/app/components/AnimatedNumber";
import MotionRoot from "@/app/components/MotionRoot";
import EmptyState from "@/app/components/EmptyState";
import GuideProvider, { GUIDE_STEPS, GUIDE_STORAGE_KEY, useGuide } from "@/app/components/FirstVisitGuide";
import Skeleton from "@/app/components/Skeleton";
import ToastProvider, { useToast } from "@/app/components/ToastProvider";
import UsageView from "@/app/usage/UsageView";
import { DRAFT_LABEL } from "@/lib/projects";

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  setReducedMotion(false);
  MotionGlobalConfig.skipAnimations = false;
});

describe("움직임 줄이기", () => {
  test("CSS의 모든 움직임을 멈추는 규칙이 있다", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    const block = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation-duration: 0.001ms !important");
    expect(block).toContain("transition-duration: 0.001ms !important");
  });

  test("잔액 숫자가 세지 않고 바로 새 값이 된다", async () => {
    setReducedMotion(true);
    const { rerender } = render(<AnimatedNumber value={80_000} format={won} />);
    expect(screen.getByTestId("animated-number").textContent).toBe("80,000원");

    rerender(<AnimatedNumber value={79_980} format={won} />);
    await waitFor(() => expect(screen.getByTestId("animated-number").textContent).toBe("79,980원"));
  });

  test("motion의 움직임도 모두 건너뛴다 (흐려짐 포함)", async () => {
    // skipAnimations is the switch motion-dom checks for every animation,
    // opacity included; jsdom cannot time a fade, so the switch is checked.
    setReducedMotion(true);
    render(
      <MotionRoot>
        <p>내용</p>
      </MotionRoot>,
    );
    await waitFor(() => expect(MotionGlobalConfig.skipAnimations).toBe(true));

  });

  test("움직임을 켜 두면 새 값까지 세어 간다", async () => {
    setReducedMotion(false);
    const { rerender } = render(<AnimatedNumber value={80_000} format={won} />);
    rerender(<AnimatedNumber value={70_000} format={won} />);
    await waitFor(() => expect(screen.getByTestId("animated-number").textContent).toBe("70,000원"), {
      timeout: 2000,
    });
  });
});

function OpenAgain() {
  const { open } = useGuide();
  return (
    <button type="button" onClick={open}>
      안내 다시 보기
    </button>
  );
}

describe("첫 안내", () => {
  test("처음에 한 번 뜨고, 닫으면 다시 뜨지 않는다", async () => {
    const user = userEvent.setup();
    const first = render(
      <GuideProvider autoOpen>
        <OpenAgain />
      </GuideProvider>,
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(GUIDE_STEPS[0].title)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "건너뛰기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.localStorage.getItem(GUIDE_STORAGE_KEY)).toBe("1");
    first.unmount();

    render(
      <GuideProvider autoOpen>
        <OpenAgain />
      </GuideProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("다시 열 수 있고, 다섯 장을 넘겨 끝낼 수 있다", async () => {
    window.localStorage.setItem(GUIDE_STORAGE_KEY, "1");
    const user = userEvent.setup();
    render(
      <GuideProvider autoOpen>
        <OpenAgain />
      </GuideProvider>,
    );
    await user.click(screen.getByRole("button", { name: "안내 다시 보기" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    expect(GUIDE_STEPS).toHaveLength(5);
    for (let i = 1; i < GUIDE_STEPS.length; i++) {
      await user.click(screen.getByRole("button", { name: "다음" }));
      expect(await screen.findByText(GUIDE_STEPS[i].title)).toBeTruthy();
    }
    // The last step holds the promo video: no autoplay, muted until asked.
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.getAttribute("src")).toMatch(/\/promo\/ctrlai-intro-(desktop|mobile)-v1\.mp4$/);
    expect(screen.getByRole("button", { name: "소리 켜기" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "시작하기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("빈 목록", () => {
  test("설명과 할 일 하나를 보여 준다", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="아직 만든 앱이 없어요"
        text="만들고 싶은 앱을 설명하면 작은 예시 앱부터 만들어 드려요."
        action={{ label: "첫 앱 만들기", onClick }}
      />,
    );
    expect(screen.getByText("아직 만든 앱이 없어요")).toBeTruthy();
    expect(screen.getByText(/예시 앱부터/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "첫 앱 만들기" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("실제 화면 — 쓴 기록이 없는 Usage", async () => {
    getMyUsage.mockResolvedValue({
      quarter_code: "2026-Q4",
      quarter_name: "2026 Q4",
      days_remaining: 80,
      membership_status: "active",
      wallet: { budget_krw: 80_000, consumed_krw: 0, remaining_krw: 80_000 },
      breakdown: [],
      personal: { balance_krw: 0, consumed_krw: 0, remaining_krw: 0, overage_enabled: false },
      events: [],
    });
    render(<UsageView />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty.textContent).toContain("아직 쓴 기록이 없어요");
    expect(screen.getByRole("link", { name: "Chat에서 시작하기" })).toBeTruthy();
  });

  test("링크로 가는 할 일도 된다", () => {
    render(<EmptyState title="t" text="x" action={{ label: "Chat에서 시작하기", href: "/" }} />);
    expect(screen.getByRole("link", { name: "Chat에서 시작하기" }).getAttribute("href")).toBe("/");
  });
});

describe("나머지", () => {
  test("불러오는 동안 막대를 보여 주고, 읽기 프로그램에는 글로 알린다", () => {
    render(<Skeleton label="모델 목록을 불러오는 중…" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("모델 목록을 불러오는 중…");
  });

  test("알림이 잠깐 떴다가 사라진다", async () => {
    function Trigger() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast.show("이름을 바꿨어요.")}>
          바꾸기
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "바꾸기" }));
    expect(await screen.findByText("이름을 바꿨어요.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("이름을 바꿨어요.")).toBeNull(), { timeout: 5000 });
  }, 10_000);

  test("상태 배지는 개발자 말 대신 '작성 중'", () => {
    expect(DRAFT_LABEL).toBe("작성 중");
  });
});
