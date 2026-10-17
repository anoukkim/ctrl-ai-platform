/**
 * Admin › Members › 회원 패널 › 지운 작업 — 복구와 완전히 삭제
 * (ui-improvements B, moved into the member panel by admin-consolidation v3).
 *
 * 그 회원의 것만 보이고, 완전히 삭제는 무슨 일이 생기는지(되살릴 수 없음,
 * 돈 기록은 남음)를 말하며, 사유 없이는 확인되지 않고, 확인하면 사유와 함께
 * 한 번 보냅니다. 복구는 사유 없이 확인 한 번.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { DeletedItem } from "@/lib/projects";

const listDeletedItems = vi.fn();
const restoreWork = vi.fn();
const purgeWork = vi.fn();
vi.mock("@/lib/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projects")>()),
  listDeletedItems: () => listDeletedItems(),
  restoreWork: (...args: unknown[]) => restoreWork(...args),
  purgeWork: (...args: unknown[]) => purgeWork(...args),
}));
vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));

const { default: MemberDeletedWork } = await import("@/app/admin/members/[id]/MemberDeletedWork");

const ITEM: DeletedItem = {
  kind: "builder",
  id: 7,
  name: "가계부",
  owner_user_id: 2,
  owner_username: "yuri",
  owner_display_name: "김유리",
  deleted_at: "2026-10-16T01:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-15T00:00:00Z",
};
const OTHER: DeletedItem = { ...ITEM, id: 8, name: "남의 앱", owner_user_id: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  listDeletedItems.mockResolvedValue([ITEM, OTHER]);
  purgeWork.mockResolvedValue(undefined);
  restoreWork.mockResolvedValue(undefined);
});

describe("회원 패널 › 지운 작업", () => {
  test("그 회원의 지운 작업만 보이고, 분기 마감 때 사라진다고 말한다", async () => {
    render(<MemberDeletedWork userId={2} />);
    expect(await screen.findByText("가계부")).toBeTruthy();
    expect(screen.queryByText("남의 앱")).toBeNull();
    expect(screen.getByText(/분기 마감 때 남아 있으면 함께 사라져요/)).toBeTruthy();
  });

  test("완전히 삭제: 확인창이 무슨 일이 생기는지 말하고, 사유 없이는 보내지 않으며, 사유와 함께 한 번 보낸다", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<MemberDeletedWork userId={2} onChanged={onChanged} />);
    await user.click(await screen.findByRole("button", { name: "완전히 삭제" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/되살릴 수 없습니다/)).toBeTruthy();
    expect(within(dialog).getByText(/사용량 기록과 지갑은 그대로입니다/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "완전히 삭제" }));
    expect(purgeWork).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole("textbox"), "회원이 완전 삭제를 요청함");
    listDeletedItems.mockResolvedValue([OTHER]);
    await user.click(within(dialog).getByRole("button", { name: "완전히 삭제" }));
    await waitFor(() => expect(purgeWork).toHaveBeenCalledWith("builder", 7, "회원이 완전 삭제를 요청함"));
    expect(purgeWork).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/완전히 삭제했습니다/)).toBeTruthy();
    expect(await screen.findByText("지운 작업이 없어요.")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  test("복구는 사유 없이 확인 한 번", async () => {
    const user = userEvent.setup();
    render(<MemberDeletedWork userId={2} />);
    await user.click(await screen.findByRole("button", { name: "복구" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "복구" }));
    await waitFor(() => expect(restoreWork).toHaveBeenCalledWith("builder", 7));
    expect(purgeWork).not.toHaveBeenCalled();
  });
});
