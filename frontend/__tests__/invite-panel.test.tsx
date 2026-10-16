/**
 * Admin › Members › 초대 코드 — 최대 가입 수를 나중에 바꾸기 (owner-polish 1).
 *
 * 2026-10-16 production had one code, 소진 1/1, and no way to let a second
 * person in short of making another code. The row now has 바꾸기: an
 * inline number, a confirm dialog, then PATCH. Below the sign-ups already
 * made the button stays off — the backend refuses too, but the screen
 * should not offer what will be refused.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Invite } from "@/lib/invites";

const USED: Invite = {
  id: 3,
  code: "CTRL-ABCD-EFGH",
  label: "첫 초대",
  max_uses: 1,
  uses: 1,
  expires_at: null,
  is_active: true,
  status: "exhausted",
  created_by_username: "admin",
  created_at: "2026-10-01T00:00:00Z",
  signups: [{ user_id: 9, username: "first", display_name: "첫 회원", signed_up_at: "2026-10-02T00:00:00Z" }],
};

const listInvites = vi.fn();
const updateInviteMaxUses = vi.fn();

vi.mock("@/lib/invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invites")>()),
  listInvites: () => listInvites(),
  updateInviteMaxUses: (...args: unknown[]) => updateInviteMaxUses(...args),
}));
vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));

const { default: InviteCodePanel } = await import("@/app/admin/members/InviteCodePanel");

beforeEach(() => {
  vi.clearAllMocks();
  listInvites.mockResolvedValue([USED]);
  updateInviteMaxUses.mockResolvedValue({ ...USED, max_uses: 5, status: "usable" });
});

describe("초대 코드 최대 가입 수", () => {
  test("바꾸기 → 숫자 → 확인창 → PATCH, 그리고 목록을 다시 읽는다", async () => {
    const user = userEvent.setup();
    render(<InviteCodePanel />);
    await screen.findByText("CTRL-ABCD-EFGH");
    expect(screen.getByText("1 / 1")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "CTRL-ABCD-EFGH 최대 가입 수 바꾸기" }));
    const field = screen.getByRole("textbox", { name: "CTRL-ABCD-EFGH 최대 가입 수" });
    await user.clear(field);
    await user.type(field, "5");
    await user.click(screen.getByRole("button", { name: "바꾸기" }));

    // 바꾸기 전에 확인창이 뜨고, 아직 아무것도 보내지 않았습니다.
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("1명에서 5명으로");
    expect(dialog.textContent).toContain("이미 가입한 1명은 그대로");
    expect(updateInviteMaxUses).not.toHaveBeenCalled();

    const confirmButtons = screen.getAllByRole("button", { name: "바꾸기" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(updateInviteMaxUses).toHaveBeenCalledWith(3, 5));
    await waitFor(() => expect(listInvites).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/최대 가입 수를 5명으로 바꿨습니다/)).toBeTruthy();
  });

  test("이미 가입한 수 아래로는 단추가 꺼지고 이유가 보인다", async () => {
    const user = userEvent.setup();
    render(<InviteCodePanel />);
    await screen.findByText("CTRL-ABCD-EFGH");

    await user.click(screen.getByRole("button", { name: "CTRL-ABCD-EFGH 최대 가입 수 바꾸기" }));
    const field = screen.getByRole("textbox", { name: "CTRL-ABCD-EFGH 최대 가입 수" });
    await user.clear(field);
    await user.type(field, "0");

    expect(screen.getByRole("button", { name: "바꾸기" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/1~1000 사이로 적어 주세요 \(이미 1명 가입\)/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("textbox", { name: "CTRL-ABCD-EFGH 최대 가입 수" })).toBeNull();
    expect(updateInviteMaxUses).not.toHaveBeenCalled();
  });
});
