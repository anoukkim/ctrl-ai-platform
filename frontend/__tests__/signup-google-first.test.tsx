/**
 * signup-google-first — 새 비밀번호 화면과 "로그인 방법을 하나 더" 띠.
 *
 * 증명하는 것:
 *   - /login/reset: 허가가 있으면 아이디와 남은 시간을 보이고, 두 칸이
 *     같고 8자 이상일 때만 저장할 수 있으며, 저장하면 바로 로그인한다.
 *     허가가 없거나 지났으면 로그인 화면으로 보낸다.
 *   - 띠: 둘 중 하나가 없는 회원(관리자 포함)에게만 보이고, 없는 쪽을
 *     만들라고 Profile로 보낸다. 둘 다 있으면, 로그인 전이면, 예전
 *     서버(has_google 없음)면 보이지 않는다. 띠가 보일 때는 <html
 *     data-signin-notice>가 붙어 화면 높이 계산이 띠를 뺀다.
 *   - /login/reset은 로그인 없이 볼 수 있는 화면이다.
 *
 * 규칙(10분, 한 번만, 다른 브라우저 로그아웃)은 백엔드 테스트가 증명합니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { CurrentUser } from "@/lib/auth";
import type { SiteInfo } from "@/lib/site";

let site: SiteInfo;
vi.mock("@/app/components/SiteProvider", () => ({
  useSite: () => site,
  useSiteLoaded: () => true,
}));

type UserState =
  | { phase: "loading" }
  | { phase: "authenticated"; user: CurrentUser }
  | { phase: "anonymous" };
let userState: UserState = { phase: "anonymous" };
const refresh = vi.fn().mockResolvedValue(undefined);
vi.mock("@/app/components/CurrentUserProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/components/CurrentUserProvider")>();
  return { ...actual, useCurrentUser: () => ({ state: userState, refresh, signOut: vi.fn() }) };
});

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const fetchResetPending = vi.fn();
const completePasswordReset = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    fetchResetPending: () => fetchResetPending(),
    completePasswordReset: (...args: unknown[]) => completePasswordReset(...args),
  };
});

const { default: ResetPasswordForm } = await import("@/app/login/reset/ResetPasswordForm");
const { default: SignInMethodBanner } = await import("@/app/components/SignInMethodBanner");
const { isPublicPath } = await import("@/app/components/CurrentUserProvider");

function siteWith(google: boolean): SiteInfo {
  return {
    environment: "development",
    is_development: true,
    is_beta: false,
    data_location_notice: "",
    top_ups_enabled: true,
    google_login: google,
    test_mode: { chat: false, builder: false, video: false, community: false },
  };
}

function member(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 2,
    username: "yuri",
    email: "yuri@example.com",
    display_name: "김유리",
    role: "member",
    account_status: "active",
    is_admin: false,
    has_password: true,
    has_google: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  site = siteWith(true);
  userState = { phase: "anonymous" };
  delete document.documentElement.dataset.signinNotice;
});

describe("새 비밀번호 화면", () => {
  test("아이디와 남은 시간을 보이고, 두 칸이 같고 8자 이상일 때만 저장한다", async () => {
    fetchResetPending.mockResolvedValue({ username: "yuri", seconds_left: 540 });
    completePasswordReset.mockResolvedValue(member());
    const user = userEvent.setup();
    render(<ResetPasswordForm />);

    const status = (await screen.findByText("yuri")).closest("p")!;
    expect(status.textContent).toContain("9분 안에");

    const submit = screen.getByRole("button", { name: "저장하고 로그인" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByLabelText("새 비밀번호"), "short");
    await user.type(screen.getByLabelText("새 비밀번호 확인"), "short");
    expect(submit.disabled).toBe(true);
    await user.clear(screen.getByLabelText("새 비밀번호"));
    await user.clear(screen.getByLabelText("새 비밀번호 확인"));
    await user.type(screen.getByLabelText("새 비밀번호"), "a-brand-new-one");
    await user.type(screen.getByLabelText("새 비밀번호 확인"), "a-brand-new-two");
    expect(submit.disabled).toBe(true);
    expect(screen.getByText("두 칸의 비밀번호가 달라요.")).toBeTruthy();
    await user.clear(screen.getByLabelText("새 비밀번호 확인"));
    await user.type(screen.getByLabelText("새 비밀번호 확인"), "a-brand-new-one");
    expect(submit.disabled).toBe(false);

    await user.click(submit);
    await waitFor(() => expect(completePasswordReset).toHaveBeenCalledWith("a-brand-new-one", "a-brand-new-one"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalled();
  });

  test("허가가 없거나 지났으면 이유와 로그인 화면 링크를 보인다", async () => {
    fetchResetPending.mockRejectedValue(
      new ApiError("비밀번호를 바꿀 수 있는 시간이 지났어요. 로그인 화면에서 다시 시작해 주세요.", 404),
    );
    render(<ResetPasswordForm />);
    expect((await screen.findByRole("alert")).textContent).toContain("시간이 지났어요");
    expect(screen.getByRole("link", { name: "로그인 화면으로" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByLabelText("새 비밀번호")).toBeNull();
  });

  test("백엔드가 거절하면 그 이유가 보이고 폼은 남는다", async () => {
    fetchResetPending.mockResolvedValue({ username: "yuri", seconds_left: 30 });
    completePasswordReset.mockRejectedValue(new ApiError("두 칸의 비밀번호가 달라요.", 400));
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await screen.findByText("yuri");
    await user.type(screen.getByLabelText("새 비밀번호"), "a-brand-new-one");
    await user.type(screen.getByLabelText("새 비밀번호 확인"), "a-brand-new-one");
    await user.click(screen.getByRole("button", { name: "저장하고 로그인" }));
    expect((await screen.findByRole("alert")).textContent).toContain("달라요");
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("새 비밀번호")).toBeTruthy();
  });

  test("로그인 없이 볼 수 있는 화면이다", () => {
    expect(isPublicPath("/login/reset")).toBe(true);
  });
});

describe("로그인 방법 안내 띠", () => {
  test("비밀번호만 있는 회원에게는 Google 연결하기로 보낸다", () => {
    userState = { phase: "authenticated", user: member({ has_google: false }) };
    render(<SignInMethodBanner />);
    const region = screen.getByRole("region", { name: "로그인 방법 안내" });
    expect(region.textContent).toContain("로그인 방법을 하나 더 만들어 주세요");
    expect(region.textContent).toContain("Google 계정과 아이디·비밀번호가 둘 다 필요해요");
    const link = screen.getByRole("link", { name: "Google 연결하기" });
    expect(link.getAttribute("href")).toBe("/profile#sign-in-methods");
    expect(document.documentElement.dataset.signinNotice).toBe("");
  });

  test("Google만 있는 회원(관리자도)에게는 비밀번호 만들기로 보낸다", () => {
    userState = { phase: "authenticated", user: member({ has_password: false, is_admin: true, role: "admin" }) };
    render(<SignInMethodBanner />);
    expect(screen.getByRole("link", { name: "비밀번호 만들기" })).toBeTruthy();
  });

  test("둘 다 있으면, 로그인 전이면, 예전 서버면 띠가 없다", () => {
    userState = { phase: "authenticated", user: member() };
    const { unmount } = render(<SignInMethodBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.documentElement.dataset.signinNotice).toBeUndefined();
    unmount();

    userState = { phase: "anonymous" };
    render(<SignInMethodBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    unmount();

    userState = { phase: "authenticated", user: member({ has_google: undefined }) };
    render(<SignInMethodBanner />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  test("Google이 꺼진 서버에서 비밀번호만 있는 회원은 조용히 둔다", () => {
    site = siteWith(false);
    userState = { phase: "authenticated", user: member({ has_google: false }) };
    render(<SignInMethodBanner />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  test("띠가 사라지면 <html data-signin-notice>도 떼어 낸다", () => {
    userState = { phase: "authenticated", user: member({ has_google: false }) };
    const { unmount } = render(<SignInMethodBanner />);
    expect(document.documentElement.dataset.signinNotice).toBe("");
    unmount();
    expect(document.documentElement.dataset.signinNotice).toBeUndefined();
  });
});
