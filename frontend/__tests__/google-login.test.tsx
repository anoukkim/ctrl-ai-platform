/**
 * google-login — Google이 기본 로그인입니다.
 *
 * 증명하는 것:
 *   - Google 로그인이 켜진 곳: 로그인·가입 화면에는 "Google로 계속하기"만
 *     있고 비밀번호 칸은 없다. 꺼진 곳(설정 전의 서버)은 지금처럼 비밀번호.
 *   - 관리자 비상 로그인(/login/password)은 언제나 비밀번호 칸.
 *   - 초대 링크의 코드는 설정 화면까지 따라간다.
 *   - 설정 화면: 초대 코드가 필요한 사람에게만 칸이 있고, 같은 이메일의 계정이
 *     있으면 새로 만들지 않고 연결하라고 안내한다.
 *   - Profile: 연결 상태와 연결하기 링크.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { SiteInfo } from "@/lib/site";

let site: SiteInfo;
vi.mock("@/app/components/SiteProvider", () => ({
  useSite: () => site,
  useSiteLoaded: () => true,
}));

vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({ refresh: vi.fn().mockResolvedValue(undefined) }),
}));

const fetchGooglePending = vi.fn();
const completeGoogleSignup = vi.fn();
const fetchGoogleConnection = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    fetchGooglePending: () => fetchGooglePending(),
    completeGoogleSignup: (...args: unknown[]) => completeGoogleSignup(...args),
    fetchGoogleConnection: () => fetchGoogleConnection(),
  };
});

const { default: LoginForm } = await import("@/app/login/LoginForm");
const { default: SignupForm } = await import("@/app/signup/SignupForm");
const { default: GoogleSetupForm } = await import("@/app/signup/google/GoogleSetupForm");
const { default: GoogleConnectionRow } = await import("@/app/profile/GoogleConnectionRow");

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

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("로그인", () => {
  test("Google 로그인이 켜져 있으면 Google 버튼만 있다", () => {
    site = siteWith(true);
    render(<LoginForm />);
    const google = screen.getByRole("link", { name: "Google로 계속하기" });
    expect(google.getAttribute("href")).toBe("/api/auth/google/start");
    expect(screen.queryByLabelText("비밀번호")).toBeNull();
  });

  test("꺼져 있으면 지금처럼 아이디와 비밀번호", () => {
    site = siteWith(false);
    render(<LoginForm />);
    expect(screen.getByLabelText("비밀번호")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Google로 계속하기" })).toBeNull();
  });

  test("관리자 비상 로그인은 언제나 비밀번호 칸", () => {
    site = siteWith(true);
    render(<LoginForm mode="password" />);
    expect(screen.getByRole("heading", { name: "관리자 로그인" })).toBeTruthy();
    expect(screen.getByLabelText("비밀번호")).toBeTruthy();
  });
});

describe("회원가입", () => {
  test("Google로 가입하고, 초대 링크의 코드는 설정 화면까지 들고 간다", () => {
    site = siteWith(true);
    render(<SignupForm initialCode="CLUB-2026" />);
    expect(screen.getByRole("link", { name: "Google로 계속하기" })).toBeTruthy();
    expect(screen.queryByLabelText("비밀번호")).toBeNull();
    expect(window.sessionStorage.getItem("ctrlai.invite-code")).toBe("CLUB-2026");
  });
});

describe("Google 설정 화면", () => {
  test("아이디·이름·초대 코드를 정해 가입한다", async () => {
    window.sessionStorage.setItem("ctrlai.invite-code", "CLUB-2026");
    fetchGooglePending.mockResolvedValue({
      email: "new@example.com",
      email_verified: true,
      name: "새 회원",
      suggested_username: "new",
      needs_invite_code: true,
      email_taken: false,
    });
    completeGoogleSignup.mockResolvedValue({});
    const user = userEvent.setup();
    render(<GoogleSetupForm />);

    expect(await screen.findByText("new@example.com")).toBeTruthy();
    expect((screen.getByLabelText("초대 코드") as HTMLInputElement).value).toBe("CLUB-2026");
    await user.clear(screen.getByLabelText("아이디"));
    await user.type(screen.getByLabelText("아이디"), "newbie");
    await user.click(screen.getByRole("button", { name: "가입하고 시작하기" }));

    expect(completeGoogleSignup).toHaveBeenCalledWith({
      username: "newbie",
      display_name: "새 회원",
      invite_code: "CLUB-2026",
    });
  });

  test("관리자 이메일이면 초대 코드 칸이 없다", async () => {
    fetchGooglePending.mockResolvedValue({
      email: "owner@example.com",
      email_verified: true,
      name: "운영자",
      suggested_username: "owner",
      needs_invite_code: false,
      email_taken: false,
    });
    render(<GoogleSetupForm />);
    expect(await screen.findByText("owner@example.com")).toBeTruthy();
    expect(screen.queryByLabelText("초대 코드")).toBeNull();
  });

  test("같은 이메일의 계정이 있으면 새로 만들지 않고 연결하라고 한다", async () => {
    fetchGooglePending.mockResolvedValue({
      email: "old@example.com",
      email_verified: true,
      name: "",
      suggested_username: "old",
      needs_invite_code: true,
      email_taken: true,
    });
    render(<GoogleSetupForm />);
    expect((await screen.findByRole("alert")).textContent).toContain("Profile에서 Google을 연결");
    expect(screen.queryByRole("button", { name: "가입하고 시작하기" })).toBeNull();
  });
});

describe("Profile의 Google 연결", () => {
  test("연결 전에는 연결하기 링크", async () => {
    fetchGoogleConnection.mockResolvedValue({ available: true, linked: false, email: "" });
    render(<GoogleConnectionRow />);
    const link = await screen.findByRole("link", { name: "연결하기" });
    expect(link.getAttribute("href")).toBe("/api/account/google/link/start");
  });

  test("연결되면 어느 계정인지 보여 준다", async () => {
    fetchGoogleConnection.mockResolvedValue({ available: true, linked: true, email: "me@example.com" });
    render(<GoogleConnectionRow />);
    expect(await screen.findByText("연결됨")).toBeTruthy();
    expect(screen.getByText("me@example.com(으)로 로그인합니다.")).toBeTruthy();
  });
});

describe("검토에서 나온 것", () => {
  test("Google에서 확인되지 않은 이메일로는 가입할 수 없다", async () => {
    fetchGooglePending.mockResolvedValue({
      email: "unverified@example.com",
      email_verified: false,
      name: "",
      suggested_username: "unverified",
      needs_invite_code: true,
      email_taken: false,
    });
    render(<GoogleSetupForm />);
    expect((await screen.findByRole("alert")).textContent).toContain("이메일 확인이 끝나지 않았어요");
    expect(screen.queryByRole("button", { name: "가입하고 시작하기" })).toBeNull();
  });

  test("주소의 ?google= 값은 아는 것만 문장이 된다", async () => {
    const { googleResultMessage } = await import("@/lib/auth");
    expect(googleResultMessage("linked")).toContain("연결했어요");
    expect(googleResultMessage("constructor")).toBeNull();
    expect(googleResultMessage("toString")).toBeNull();
    expect(googleResultMessage(null)).toBeNull();
  });
});
