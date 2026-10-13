/**
 * member-password-login — Profile › 로그인 방법.
 *
 * 증명하는 것:
 *   - Google만 있는 회원: 비밀번호 만들기가 있고, Google 연결 끊기는 꺼져 있다.
 *   - 비밀번호만 있는 회원: Google 연결하기 링크, 비밀번호 없애기는 꺼져 있다.
 *   - 둘 다 있는 회원: 어느 쪽이든 없앨 수 있고, 지금 비밀번호를 묻는다.
 *   - 만들기는 두 칸이 같고 8자 이상일 때만 보낼 수 있다.
 *   - 백엔드가 거절하면 그 이유가 보인다.
 *   - /login/password는 /login으로 보낸다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { SignInMethods } from "@/lib/auth";

const refresh = vi.fn().mockResolvedValue(undefined);
vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({ refresh }),
}));

const api = {
  fetchSignInMethods: vi.fn(),
  setPassword: vi.fn(),
  removePassword: vi.fn(),
  unlinkGoogle: vi.fn(),
};
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    fetchSignInMethods: () => api.fetchSignInMethods(),
    setPassword: (...args: unknown[]) => api.setPassword(...args),
    removePassword: (...args: unknown[]) => api.removePassword(...args),
    unlinkGoogle: (...args: unknown[]) => api.unlinkGoogle(...args),
  };
});

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/profile",
}));

const { default: SignInMethodsSection } = await import("@/app/profile/SignInMethodsSection");

function methods(password: boolean, linked: boolean): SignInMethods {
  return {
    password,
    google: { available: true, linked, email: linked ? "me@gmail.com" : "" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Profile › 로그인 방법", () => {
  test("Google만 있으면 비밀번호를 만들 수 있고, Google은 끊을 수 없다", async () => {
    api.fetchSignInMethods.mockResolvedValue(methods(false, true));
    render(<SignInMethodsSection />);

    expect(await screen.findByText("me@gmail.com(으)로 로그인합니다.")).toBeTruthy();
    const unlink = screen.getByRole("button", { name: "연결 끊기" }) as HTMLButtonElement;
    expect(unlink.disabled).toBe(true);
    expect(screen.getByText("Google 연결을 끊으려면 먼저 비밀번호를 만들어 주세요.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "만들기" })).toBeTruthy();
  });

  test("비밀번호만 있으면 Google을 연결할 수 있고, 비밀번호는 없앨 수 없다", async () => {
    api.fetchSignInMethods.mockResolvedValue(methods(true, false));
    render(<SignInMethodsSection />);

    const link = await screen.findByRole("link", { name: "연결하기" });
    expect(link.getAttribute("href")).toBe("/api/account/google/link/start");
    const remove = screen.getByRole("button", { name: "없애기" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(screen.getByText("비밀번호를 없애려면 먼저 Google을 연결해 주세요.")).toBeTruthy();
  });

  test("비밀번호 만들기는 두 칸이 같고 8자 이상이어야 보낸다", async () => {
    api.fetchSignInMethods.mockResolvedValue(methods(false, true));
    api.setPassword.mockResolvedValue(methods(true, true));
    const user = userEvent.setup();
    render(<SignInMethodsSection />);

    await user.click(await screen.findByRole("button", { name: "만들기" }));
    const save = screen.getByRole("button", { name: "저장" }) as HTMLButtonElement;
    await user.type(screen.getByLabelText("새 비밀번호"), "short");
    expect(save.disabled).toBe(true);
    expect(screen.getByText("8자 이상 입력해 주세요.")).toBeTruthy();

    await user.clear(screen.getByLabelText("새 비밀번호"));
    await user.type(screen.getByLabelText("새 비밀번호"), "long-enough-1");
    await user.type(screen.getByLabelText("새 비밀번호 한 번 더"), "long-enough-2");
    expect(screen.getByText("두 칸의 비밀번호가 달라요.")).toBeTruthy();
    expect(save.disabled).toBe(true);

    await user.clear(screen.getByLabelText("새 비밀번호 한 번 더"));
    await user.type(screen.getByLabelText("새 비밀번호 한 번 더"), "long-enough-1");
    await user.click(save);

    expect(api.setPassword).toHaveBeenCalledWith("long-enough-1");
    await waitFor(() => expect(screen.getByText("사용 중")).toBeTruthy());
    // 탈퇴 칸이 비밀번호를 묻도록 현재 사용자를 다시 읽습니다.
    expect(refresh).toHaveBeenCalled();
  });

  test("둘 다 있으면 비밀번호를 없앨 수 있고, 지금 비밀번호를 묻는다", async () => {
    api.fetchSignInMethods.mockResolvedValue(methods(true, true));
    api.removePassword.mockResolvedValue(methods(false, true));
    const user = userEvent.setup();
    render(<SignInMethodsSection />);

    await user.click(await screen.findByRole("button", { name: "없애기" }));
    await user.type(screen.getByLabelText("지금 비밀번호"), "memberpassword");
    const forms = screen.getAllByRole("button", { name: "없애기" });
    await user.click(forms[forms.length - 1]);

    expect(api.removePassword).toHaveBeenCalledWith("memberpassword");
    await waitFor(() => expect(screen.getByRole("button", { name: "만들기" })).toBeTruthy());
  });

  test("둘 다 있으면 Google 연결을 끊을 수 있다", async () => {
    api.fetchSignInMethods.mockResolvedValue(methods(true, true));
    api.unlinkGoogle.mockResolvedValue(methods(true, false));
    const user = userEvent.setup();
    render(<SignInMethodsSection />);

    await user.click(await screen.findByRole("button", { name: "연결 끊기" }));
    await user.type(screen.getByLabelText("지금 비밀번호"), "memberpassword");
    const buttons = screen.getAllByRole("button", { name: "연결 끊기" });
    await user.click(buttons[buttons.length - 1]);

    expect(api.unlinkGoogle).toHaveBeenCalledWith("memberpassword");
    expect(await screen.findByRole("link", { name: "연결하기" })).toBeTruthy();
  });

  test("백엔드가 거절하면 그 이유를 보여 준다", async () => {
    api.fetchSignInMethods.mockResolvedValue(methods(true, true));
    api.removePassword.mockRejectedValue(new ApiError("지금 쓰는 비밀번호가 올바르지 않습니다.", 400));
    const user = userEvent.setup();
    render(<SignInMethodsSection />);

    await user.click(await screen.findByRole("button", { name: "없애기" }));
    await user.type(screen.getByLabelText("지금 비밀번호"), "wrong");
    const forms = screen.getAllByRole("button", { name: "없애기" });
    await user.click(forms[forms.length - 1]);

    expect((await screen.findByRole("alert")).textContent).toContain("올바르지 않습니다");
  });
});

describe("예전 주소", () => {
  test("/login/password는 /login으로 보낸다", async () => {
    const { default: PasswordLoginPage } = await import("@/app/login/password/page");
    PasswordLoginPage();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
