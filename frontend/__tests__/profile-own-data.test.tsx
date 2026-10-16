/**
 * Profile은 로그인한 회원 자신의 데이터만 보여 준다 (fix-beta-blockers 1,
 * owner-polish 3).
 *
 * Phase 0의 목업은 "yurikim"의 앱 두 개를 **모든** 회원의 Profile에
 * 보여 줬습니다. 그 뒤로는 게시가 생겼는데도 "준비 중 · 아직 게시한 앱이
 * 없어요"가 고정으로 남아 있었습니다 (owner-polish 3, 2026-10-16). 이제
 * 내가 만든 앱은 `/api/apps/mine`을 읽습니다 — 내 것만, 목업 없이.
 *
 * 분기·계정·로그인 방법 카드는 자기 테스트가 따로 있으므로 여기서는
 * 비워 둡니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AppListing } from "@/lib/apps";

vi.mock("@/app/profile/AccountIdentity", () => ({
  AccountSettings: () => null,
  Identity: () => null,
  NotificationSettings: () => null,
}));
vi.mock("@/app/profile/ProjectSummary", () => ({ default: () => null }));
vi.mock("@/app/profile/QuarterParticipation", () => ({ default: () => null }));
vi.mock("@/app/profile/SignInMethodsSection", () => ({ default: () => null }));
vi.mock("@/app/profile/WithdrawalSection", () => ({ default: () => null }));
vi.mock("@/app/profile/ConnectedAppsSection", () => ({ default: () => null }));
vi.mock("@/app/profile/DefaultModelSection", () => ({ default: () => null }));

const listMyApps = vi.fn<() => Promise<AppListing[]>>();
vi.mock("@/lib/apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apps")>()),
  listMyApps: () => listMyApps(),
}));

const { default: ProfilePage } = await import("@/app/profile/page");

const MINE: AppListing = {
  id: 7,
  slug: "trip-planner",
  name: "여행 일정 메이커",
  description: "여행 일정을 짜 주는 앱",
  author_name: "나",
  author_username: "dev",
  version_number: 3,
  published_at: new Date().toISOString(),
  publish_note: "",
  app_url: null,
  shared_lists: false,
  favorite: false,
};

describe("Profile › 내가 만든 앱", () => {
  test("게시한 앱이 없으면 빈 상태 — 목업 앱 없음, '준비 중' 없음", async () => {
    listMyApps.mockResolvedValue([]);
    render(<ProfilePage />);

    expect(await screen.findByText("아직 게시한 앱이 없어요")).toBeDefined();
    expect(screen.getByRole("link", { name: "앱 만들러 가기" })).toBeDefined();

    // Phase 0의 목업 흔적이 돌아오면 안 됩니다.
    expect(document.body.textContent).not.toContain("김유리");
    expect(document.body.textContent).not.toContain("yurikim");
    expect(document.body.textContent).not.toContain("준비 중");
  });

  test("내가 게시한 앱은 CtrlAIApps와 같은 카드로, 상세 화면으로 이어진다", async () => {
    listMyApps.mockResolvedValue([MINE]);
    render(<ProfilePage />);

    await waitFor(() => expect(screen.getByTestId("my-apps-grid")).toBeDefined());
    const card = screen.getByRole("link", { name: /여행 일정 메이커/ });
    expect(card.getAttribute("href")).toBe("/ctrlaistore/trip-planner");
    expect(screen.getByText(/v3/)).toBeDefined();
    expect(screen.getByText("1개")).toBeDefined();
    expect(screen.queryByText("아직 게시한 앱이 없어요")).toBeNull();
  });

  test("불러오지 못하면 그렇게 말하고, 다른 사람의 앱을 대신 보여 주지 않는다", async () => {
    listMyApps.mockImplementation(() => Promise.reject(new Error("연결 안 됨")));
    render(<ProfilePage />);

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("게시한 앱을 불러오지 못했습니다");
  });
});
