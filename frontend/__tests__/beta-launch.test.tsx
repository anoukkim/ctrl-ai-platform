/**
 * prep-beta-launch — 베타에서 회원이 보는 것.
 *
 * 증명하는 것:
 *   - APP_ENV=beta이면 모든 화면 위에 한국어 베타 배너가 붙고, 아니면 없다.
 *   - 목업으로 도는 화면에는 "테스트 모드 – 실제 AI 결과가 아닙니다"가
 *     붙고, 실제 제공자로 바뀐 화면에는 붙지 않는다.
 *   - 회원가입 화면에 정보가 저장되는 곳이 나온다(서버 .env의 문구).
 *   - 의견 보내기는 적은 글과 지금 화면을 백엔드에 보내고 고맙다고 말한다.
 *   - Usage는 베타에서 개인 충전을 받지 않는다고 말한다.
 *   - Admin 메뉴에 Feedback이 있고, Dev Tools는 개발 환경에서만 보인다.
 *
 * 무엇을 붙일지는 백엔드가 정합니다(`/api/site` — backend
 * tests/test_beta_launch.py가 그 답을 증명합니다). 여기서는 화면이 그 답을
 * 따르는지만 봅니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { visibleSections } from "@/app/admin/sections";
import type { SiteInfo } from "@/lib/site";

const fetchSite = vi.fn<() => Promise<SiteInfo>>();
const sendFeedback = vi.fn();
const fetchCurrentUser = vi.fn();

vi.mock("@/lib/site", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/site")>();
  return {
    ...actual,
    fetchSite: () => fetchSite(),
    sendFeedback: (...args: unknown[]) => sendFeedback(...args),
  };
});

const getMyUsage = vi.fn();

vi.mock("@/lib/quarters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quarters")>();
  return { ...actual, getMyUsage: (...args: unknown[]) => getMyUsage(...args) };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, fetchCurrentUser: () => fetchCurrentUser() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/video/12",
  useSearchParams: () => new URLSearchParams(),
}));

import BetaBanner from "@/app/components/BetaBanner";
import CurrentUserProvider from "@/app/components/CurrentUserProvider";
import { FeedbackDialog } from "@/app/components/FeedbackButton";
import SiteProvider from "@/app/components/SiteProvider";
import TestModeNotice from "@/app/components/TestModeNotice";
import DataLocationNotice from "@/app/signup/DataLocationNotice";
import UsageView from "@/app/usage/UsageView";

function site(overrides: Partial<SiteInfo> = {}): SiteInfo {
  return {
    environment: "beta",
    is_development: false,
    is_beta: true,
    data_location_notice: "회원님의 정보는 Google Cloud 서울 리전(asia-northeast3)에 저장됩니다.",
    top_ups_enabled: false,
    test_mode: { chat: false, builder: false, video: true, community: true },
    ...overrides,
  };
}

const MEMBER = {
  id: 2,
  username: "yuri",
  email: "yuri@example.com",
  display_name: "김유리",
  role: "member",
  account_status: "active",
  is_admin: false,
};

function withSite(children: React.ReactNode) {
  return (
    <SiteProvider>
      <CurrentUserProvider>{children}</CurrentUserProvider>
    </SiteProvider>
  );
}

beforeEach(() => {
  fetchSite.mockReset();
  sendFeedback.mockReset();
  fetchCurrentUser.mockReset();
  getMyUsage.mockReset();
  fetchCurrentUser.mockResolvedValue(MEMBER);
  delete document.documentElement.dataset.beta;
});

describe("베타 배너", () => {
  test("베타이면 한국어 배너와 의견 보내기가 보이고 <html data-beta>가 붙는다", async () => {
    fetchSite.mockResolvedValue(site());
    render(withSite(<BetaBanner />));

    const banner = await screen.findByRole("region", { name: "베타 안내" });
    expect(banner.textContent).toContain("시험 운영 중");
    expect(await screen.findByRole("button", { name: "의견 보내기" })).toBeTruthy();
    expect(document.documentElement.dataset.beta).toBe("");
  });

  test("로그인하기 전에도 배너는 보이지만 의견 보내기는 없다", async () => {
    fetchSite.mockResolvedValue(site());
    fetchCurrentUser.mockRejectedValue(new Error("401"));
    render(withSite(<BetaBanner />));

    expect(await screen.findByRole("region", { name: "베타 안내" })).toBeTruthy();
    await waitFor(() => expect(fetchCurrentUser).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "의견 보내기" })).toBeNull();
  });

  test("베타가 아니면 배너가 없다", async () => {
    fetchSite.mockResolvedValue(site({ environment: "production", is_beta: false }));
    render(withSite(<BetaBanner />));

    await waitFor(() => expect(fetchSite).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "베타 안내" })).toBeNull();
    expect(document.documentElement.dataset.beta).toBeUndefined();
  });
});

describe("테스트 모드 표시", () => {
  test("목업으로 도는 화면에만 붙는다", async () => {
    fetchSite.mockResolvedValue(site());
    render(
      withSite(
        <>
          <div data-testid="chat">
            <TestModeNotice area="chat" />
          </div>
          <div data-testid="video">
            <TestModeNotice area="video" />
          </div>
          <div data-testid="community">
            <TestModeNotice area="community" />
          </div>
        </>,
      ),
    );

    expect(await screen.findByText("테스트 모드 – 실제 AI 결과가 아닙니다")).toBeTruthy();
    // 실제 Claude로 도는 Chat에는 붙지 않습니다.
    expect(screen.getByTestId("chat").textContent).toBe("");
    expect(screen.getByTestId("video").textContent).toBe("테스트 모드 – 실제 AI 결과가 아닙니다");
    expect(screen.getByTestId("community").textContent).toContain("예시");
  });

  test("답을 받기 전이나 못 받았을 때는 아무것도 붙이지 않는다", async () => {
    fetchSite.mockRejectedValue(new Error("down"));
    render(withSite(<TestModeNotice area="video" />));

    await waitFor(() => expect(fetchSite).toHaveBeenCalled());
    expect(screen.queryByTestId("test-mode")).toBeNull();
  });
});

test("회원가입 화면은 정보가 저장되는 곳을 알려 준다", async () => {
  fetchSite.mockResolvedValue(site());
  render(withSite(<DataLocationNotice />));

  expect((await screen.findByTestId("data-location")).textContent).toContain(
    "Google Cloud 서울 리전(asia-northeast3)",
  );
});

describe("의견 보내기", () => {
  test("적은 글과 지금 화면을 보내고 고맙다고 말한다", async () => {
    sendFeedback.mockResolvedValue({ id: 1, body: "느려요", page: "/video/12", created_at: "" });
    const user = userEvent.setup();
    render(<FeedbackDialog onClose={vi.fn()} />);

    const send = screen.getByRole("button", { name: "보내기" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    await user.type(screen.getByLabelText("내용"), "  영상 화면이 느려요  ");
    await user.click(send);

    expect(sendFeedback).toHaveBeenCalledWith("영상 화면이 느려요", "/video/12");
    expect((await screen.findByRole("status")).textContent).toContain("고맙습니다");
  });

  test("실패하면 창을 닫지 않고 이유를 보여 준다", async () => {
    const { ApiError } = await import("@/lib/api");
    sendFeedback.mockRejectedValue(new ApiError("의견을 너무 자주 보내셨어요.", 429));
    const user = userEvent.setup();
    render(<FeedbackDialog onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("내용"), "한 번 더");
    await user.click(screen.getByRole("button", { name: "보내기" }));

    expect((await screen.findByRole("alert")).textContent).toContain("너무 자주");
    expect((screen.getByLabelText("내용") as HTMLTextAreaElement).value).toBe("한 번 더");
  });
});

describe("Usage", () => {
  const usage = {
    quarter_code: "2026-Q4",
    quarter_name: "2026 Q4",
    days_remaining: 80,
    membership_status: "active",
    wallet: { budget_krw: 80_000, consumed_krw: 0, remaining_krw: 80_000 },
    breakdown: [],
    personal: { balance_krw: 0, consumed_krw: 0, remaining_krw: 0, overage_enabled: false },
    events: [],
  };

  test("베타에서는 개인 충전을 받지 않는다고 말한다", async () => {
    fetchSite.mockResolvedValue(site());
    getMyUsage.mockResolvedValue(usage);
    render(withSite(<UsageView />));

    expect((await screen.findByTestId("top-ups-off")).textContent).toContain("개인 충전");
  });

  test("베타가 아니면 그 문장이 없다", async () => {
    fetchSite.mockResolvedValue(site({ is_beta: false, top_ups_enabled: true }));
    getMyUsage.mockResolvedValue(usage);
    render(withSite(<UsageView />));

    expect(await screen.findByText("개인 잔액")).toBeTruthy();
    await waitFor(() => expect(fetchSite).toHaveBeenCalled());
    expect(screen.queryByTestId("top-ups-off")).toBeNull();
  });
});

describe("Admin 메뉴", () => {
  test("Feedback이 있고, Dev Tools는 개발 환경에서만 보인다", () => {
    expect(visibleSections(false).map((s) => s.key)).toContain("feedback");
    expect(visibleSections(false).map((s) => s.key)).not.toContain("dev");
    expect(visibleSections(true).map((s) => s.key)).toContain("dev");
  });
});
