/**
 * 초대 코드 — 가입 화면과 Admin › Members의 초대 코드 칸.
 *
 * 규칙(코드가 쓸 수 있는지, 마지막 한 자리를 둘이 동시에 못 가져가는지)은
 * 백엔드 테스트가 증명합니다. 여기서는 화면이 그 규칙을 따르는지 봅니다.
 *
 *   1. 가입 폼에 초대 코드 칸이 있고, 비어 있으면 보낼 수 없다.
 *   2. `/signup?code=…` 링크로 오면 칸이 미리 채워져 있고, 그 코드가
 *      그대로 백엔드로 간다.
 *   3. 관리 화면은 상태를 한국어로 보이고, 링크 복사는 코드가 채워진
 *      가입 주소를 복사한다.
 *   4. 사용 중지는 확인을 받은 뒤에만 일어나고, 이미 가입한 계정은
 *      그대로라고 말한다.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Invite } from "@/lib/invites";

const register = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, register: (...args: unknown[]) => register(...args) };
});
vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({ refresh: vi.fn().mockResolvedValue(undefined) }),
}));

const invitesApi = { listInvites: vi.fn(), createInvite: vi.fn(), setInviteActive: vi.fn() };
vi.mock("@/lib/invites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invites")>();
  return {
    ...actual,
    listInvites: (...a: unknown[]) => invitesApi.listInvites(...a),
    createInvite: (...a: unknown[]) => invitesApi.createInvite(...a),
    setInviteActive: (...a: unknown[]) => invitesApi.setInviteActive(...a),
  };
});

async function fillSignup(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("아이디"), "newmember");
  await user.type(screen.getByLabelText("이름"), "새 회원");
  await user.type(screen.getByLabelText("이메일"), "new@ctrl.ai");
  await user.type(screen.getByLabelText("비밀번호"), "a-good-password");
  // privacy-and-terms: 동의해야 가입 단추가 켜집니다.
  await user.click(screen.getByRole("checkbox"));
}

describe("가입 화면", () => {
  beforeEach(() => {
    register.mockReset();
    register.mockResolvedValue({});
  });

  test("초대 코드 없이는 가입 단추가 눌리지 않는다", async () => {
    const { default: SignupForm } = await import("@/app/signup/SignupForm");
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignup(user);
    const submit = screen.getByRole("button", { name: "가입하고 시작하기" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText("초대 코드"), "club-2026");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  test("링크로 받은 코드가 채워져 있고 그대로 보내진다", async () => {
    const { default: SignupForm } = await import("@/app/signup/SignupForm");
    const user = userEvent.setup();
    render(<SignupForm initialCode="CTRL-AB12-CD34" />);

    expect((screen.getByLabelText("초대 코드") as HTMLInputElement).value).toBe("CTRL-AB12-CD34");
    await fillSignup(user);
    await user.click(screen.getByRole("button", { name: "가입하고 시작하기" }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).toMatchObject({ invite_code: "CTRL-AB12-CD34" });
  });

  test("페이지는 ?code= 를 폼에 넘긴다", async () => {
    const { default: SignupPage } = await import("@/app/signup/page");
    render(await SignupPage({ searchParams: Promise.resolve({ code: "LINK-CODE" }) }));
    expect((screen.getByLabelText("초대 코드") as HTMLInputElement).value).toBe("LINK-CODE");
  });
});

const INVITES: Invite[] = [
  {
    id: 1,
    code: "CTRL-AB12-CD34",
    label: "2026 Q4 공지용",
    max_uses: 40,
    uses: 2,
    expires_at: null,
    is_active: true,
    status: "usable",
    created_by_username: "dev",
    created_at: "2026-10-07T00:00:00Z",
    signups: [
      { user_id: 5, username: "kim", display_name: "김유리", signed_up_at: "2026-10-07T01:00:00Z" },
    ],
  },
  {
    id: 2,
    code: "OLD-CODE",
    label: "",
    max_uses: 1,
    uses: 1,
    expires_at: null,
    is_active: true,
    status: "exhausted",
    created_by_username: "dev",
    created_at: "2026-10-01T00:00:00Z",
    signups: [],
  },
];

describe("초대 코드 관리", () => {
  beforeEach(() => {
    for (const fn of Object.values(invitesApi)) fn.mockReset();
    invitesApi.listInvites.mockResolvedValue(INVITES);
  });

  test("상태와 가입한 사람을 보여 준다", async () => {
    const { default: InviteCodePanel } = await import("@/app/admin/members/InviteCodePanel");
    render(<InviteCodePanel />);

    const row = (await screen.findByText("CTRL-AB12-CD34")).closest("tr")!;
    expect(within(row).getByText("사용 가능")).toBeTruthy();
    expect(within(row).getByText("2 / 40")).toBeTruthy();
    expect(within(row).getByText("김유리")).toBeTruthy();
    const old = screen.getByText("OLD-CODE").closest("tr")!;
    expect(within(old).getByText("소진")).toBeTruthy();
  });

  test("링크 복사는 코드가 채워진 가입 주소를 복사한다", async () => {
    const { default: InviteCodePanel } = await import("@/app/admin/members/InviteCodePanel");
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<InviteCodePanel />);

    const row = (await screen.findByText("CTRL-AB12-CD34")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "링크 복사" }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/signup?code=CTRL-AB12-CD34`,
    );
  });

  test("사용 중지는 확인한 뒤에만 일어나고, 가입한 계정은 그대로라고 말한다", async () => {
    const { default: InviteCodePanel } = await import("@/app/admin/members/InviteCodePanel");
    const user = userEvent.setup();
    invitesApi.setInviteActive.mockResolvedValue({ ...INVITES[0], is_active: false });
    render(<InviteCodePanel />);

    const row = (await screen.findByText("CTRL-AB12-CD34")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "사용 중지" }));

    expect(invitesApi.setInviteActive).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("이미 이 코드로 가입한 2명의 계정은 그대로입니다");

    await user.click(within(dialog).getByRole("button", { name: "사용 중지" }));
    await waitFor(() => expect(invitesApi.setInviteActive).toHaveBeenCalledWith(1, false));
  });

  test("만들기는 확인한 뒤에 보내고, 빈 코드는 자동 생성으로 보낸다", async () => {
    const { default: InviteCodePanel } = await import("@/app/admin/members/InviteCodePanel");
    const user = userEvent.setup();
    invitesApi.createInvite.mockResolvedValue({ ...INVITES[0], id: 3, code: "CTRL-NEW1-NEW2" });
    render(<InviteCodePanel />);
    await screen.findByText("CTRL-AB12-CD34");

    await user.type(screen.getByLabelText("이름표 (예: 2026 Q4 공지용)"), "신입 환영");
    await user.clear(screen.getByLabelText("최대 가입 수 (1이면 1회용)"));
    await user.type(screen.getByLabelText("최대 가입 수 (1이면 1회용)"), "40");
    await user.click(screen.getByRole("button", { name: "초대 코드 만들기" }));
    expect(invitesApi.createInvite).not.toHaveBeenCalled();

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "만들기" }));
    await waitFor(() =>
      expect(invitesApi.createInvite).toHaveBeenCalledWith({
        code: "",
        label: "신입 환영",
        max_uses: 40,
        expires_at: null,
      }),
    );
  });
});
