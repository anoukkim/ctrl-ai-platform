/**
 * Profile › 계정 설정 — 이름 바꾸기 (owner-polish 9).
 *
 * The 아이디 stays read-only; the name gets an inline editor that PATCHes
 * and then re-reads the signed-in member, so the header, the sidebar and
 * every card that shows the name agree.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

const refresh = vi.fn().mockResolvedValue(undefined);
const updateDisplayName = vi.fn();
const user = { phase: "authenticated" as const, user: {
  id: 1, username: "dev", email: "dev@example.com", display_name: "개발자", role: "member",
  account_status: "active", is_admin: false, has_password: true, spend_notifications: true,
} };

vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({ state: user, refresh, signOut: vi.fn() }),
}));
vi.mock("@/app/components/MyQuarterProvider", () => ({ useMyQuarter: () => ({ state: { phase: "loading" } }) }));
vi.mock("@/app/components/SpendFeedbackProvider", () => ({
  useSpendFeedback: () => ({ enabled: true, setEnabled: vi.fn() }),
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  updateDisplayName: (...args: unknown[]) => updateDisplayName(...args),
}));

const { AccountSettings } = await import("@/app/profile/AccountIdentity");

beforeEach(() => {
  vi.clearAllMocks();
  updateDisplayName.mockResolvedValue({ ...user.user, display_name: "새 이름" });
});

describe("계정 설정 › 이름", () => {
  test("아이디는 입력칸이 없고, 이름은 바꾸기 → 저장 → PATCH → 다시 읽기", async () => {
    const typing = userEvent.setup();
    render(<AccountSettings />);

    expect(screen.getByText("dev")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();

    await typing.click(screen.getByRole("button", { name: "이름 바꾸기" }));
    const field = screen.getByRole("textbox", { name: "이름" });
    expect(field).toHaveProperty("value", "개발자");
    await typing.clear(field);
    await typing.type(field, "새 이름");
    await typing.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(updateDisplayName).toHaveBeenCalledWith("새 이름"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    // The 아이디 is still the same read-only text.
    expect(screen.getByText("dev")).toBeTruthy();
  });

  test("빈 이름은 저장되지 않고, 실패하면 이유가 보인다", async () => {
    const typing = userEvent.setup();
    render(<AccountSettings />);
    await typing.click(screen.getByRole("button", { name: "이름 바꾸기" }));
    const field = screen.getByRole("textbox", { name: "이름" });
    await typing.clear(field);
    expect(screen.getByRole("button", { name: "저장" })).toHaveProperty("disabled", true);
    expect(screen.getByText("이름은 1~100자로 적어 주세요.")).toBeTruthy();

    updateDisplayName.mockImplementation(() => Promise.reject(new TypeError("down")));
    await typing.type(field, "둘");
    await typing.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    // Still editing, so the member can try again.
    expect(screen.getByRole("textbox", { name: "이름" })).toBeTruthy();
  });
});
