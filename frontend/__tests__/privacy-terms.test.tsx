/**
 * privacy-and-terms — 화면 쪽.
 *
 * 두 법적 문서 페이지가 핵심 내용과 함께 렌더링되는지, 가입 동의
 * 체크박스가 단추를 잠그고 새 탭 링크를 다는지 봅니다. 백엔드의 거절은
 * backend/tests/test_privacy_terms.py가 봅니다.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/app/components/CurrentUserProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/components/CurrentUserProvider")>();
  return {
    ...actual,
    useCurrentUser: () => ({ refresh: vi.fn().mockResolvedValue(undefined) }),
  };
});

vi.mock("@/app/components/SiteProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/components/SiteProvider")>();
  return {
    ...actual,
    useSite: () => ({
      environment: "development",
      is_development: true,
      is_beta: false,
      data_location_notice: "",
      top_ups_enabled: false,
      google_login: false,
      test_mode: { chat: false, builder: false, video: false, community: false },
    }),
    useSiteLoaded: () => true,
  };
});

const { default: PrivacyPage } = await import("@/app/privacy/page");
const { default: TermsPage } = await import("@/app/terms/page");
const { default: SignupForm } = await import("@/app/signup/SignupForm");
const { PUBLIC_PATHS } = await import("@/app/components/CurrentUserProvider");

describe("법적 문서 페이지", () => {
  test("개인정보 처리방침 — 핵심 절이 모두 있다", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { name: "개인정보 처리방침" })).toBeTruthy();
    expect(screen.getByText(/시행일 2026-10-14/)).toBeTruthy();
    for (const heading of [
      /모으는 정보/,
      /어디에 쓰나/,
      /어디에 저장되나/,
      /누구에게 전달되나/,
      /얼마나 보관하나/,
      /회원의 권리/,
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.getAllByText(/ctrlai\.platform@gmail\.com/).length).toBeGreaterThan(0);
    expect(screen.getByText(/서울 리전\(asia-northeast3\)/)).toBeTruthy();
    expect(screen.getByText(/30일/)).toBeTruthy();
  });

  test("이용약관 — 핵심 절이 모두 있다", () => {
    render(<TermsPage />);

    expect(screen.getByRole("heading", { name: "이용약관" })).toBeTruthy();
    for (const heading of [
      /어떤 서비스인가/,
      /지원금과 한도/,
      /계정/,
      /만들면 안 되는 것/,
      /게시물/,
      /AI가 만든 것/,
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.getByText(/틀릴 수 있습니다/)).toBeTruthy();
  });

  test("로그인 없이 볼 수 있는 경로다", () => {
    expect(PUBLIC_PATHS).toContain("/privacy");
    expect(PUBLIC_PATHS).toContain("/terms");
  });
});

describe("가입 동의", () => {
  test("체크하기 전에는 가입 단추가 잠겨 있고, 링크는 새 탭으로 연다", async () => {
    const user = userEvent.setup();
    render(<SignupForm initialCode="CLUB-2026" />);

    await user.type(screen.getByLabelText("아이디"), "newmember");
    await user.type(screen.getByLabelText("이름"), "새 회원");
    await user.type(screen.getByLabelText("이메일"), "new@ctrl.ai");
    await user.type(screen.getByLabelText("비밀번호"), "a-good-password");

    const submit = screen.getByRole("button", { name: "가입하고 시작하기" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const links = screen.getAllByRole("link", { name: /개인정보 처리방침|이용약관/ });
    expect(links.length).toBe(2);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }

    await user.click(screen.getByRole("checkbox"));
    expect(submit.disabled).toBe(false);
  });
});
