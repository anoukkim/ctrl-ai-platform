/**
 * Profile은 로그인한 회원 자신의 데이터만 보여 준다 (fix-beta-blockers 1).
 *
 * Phase 0의 목업은 "yurikim"의 앱 두 개를 **모든** 회원의 Profile에
 * 보여 줬습니다. 앱 게시(Phase 5)가 생기기 전까지 이 목록은 누구에게나
 * 비어 있어야 하고, 목업 데이터가 다시 끼어들면 이 테스트가 막습니다.
 *
 * 분기·계정·로그인 방법 카드는 자기 테스트가 따로 있으므로 여기서는
 * 비워 둡니다.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/app/profile/AccountIdentity", () => ({
  AccountSettings: () => null,
  Identity: () => null,
  NotificationSettings: () => null,
}));
vi.mock("@/app/profile/ProjectSummary", () => ({ default: () => null }));
vi.mock("@/app/profile/QuarterParticipation", () => ({ default: () => null }));
vi.mock("@/app/profile/SignInMethodsSection", () => ({ default: () => null }));
vi.mock("@/app/profile/WithdrawalSection", () => ({ default: () => null }));

const { default: ProfilePage } = await import("@/app/profile/page");

describe("Profile › 내가 만든 앱", () => {
  test("앱 게시가 생기기 전에는 누구에게나 빈 상태 — 목업 앱 없음", () => {
    render(<ProfilePage />);

    expect(screen.getByText("아직 게시한 앱이 없어요")).toBeDefined();
    expect(screen.getByRole("link", { name: "앱 만들러 가기" })).toBeDefined();

    // Phase 0의 목업 흔적이 돌아오면 안 됩니다.
    expect(document.body.textContent).not.toContain("김유리");
    expect(document.body.textContent).not.toContain("yurikim");
    expect(document.body.textContent).not.toContain("게시됨");
  });
});
