/**
 * Admin › Deleted Items › 완전히 삭제 (ui-improvements B).
 *
 * 메뉴에서 고른 것만으로는 아무 일도 일어나지 않고, 확인창은 무슨 일이
 * 생기는지(되살릴 수 없음, 돈 기록은 남음)를 말하며, 사유 없이는 확인
 * 버튼이 눌리지 않고, 확인하면 사유와 함께 한 번 보냅니다.
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

const { default: DeletedWorkAdmin } = await import("@/app/admin/deleted/DeletedWorkAdmin");

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

beforeEach(() => {
  vi.clearAllMocks();
  listDeletedItems.mockResolvedValue([ITEM]);
  purgeWork.mockResolvedValue(undefined);
  restoreWork.mockResolvedValue(undefined);
});

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  const row = (await screen.findByText("가계부")).closest("tr") as HTMLElement;
  await user.click(within(row).getByRole("button", { name: /관리/ }));
  return row;
}

describe("완전히 삭제", () => {
  test("메뉴만 골라서는 아무 일도 없고, 확인창은 무슨 일이 생기는지 말한다", async () => {
    const user = userEvent.setup();
    render(<DeletedWorkAdmin />);
    await openMenu(user);

    await user.click(screen.getByRole("menuitem", { name: "완전히 삭제…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("되살릴 수 없습니다");
    expect(dialog.textContent).toContain("사용량 기록과 지갑은 그대로");
    expect(dialog.textContent).toContain("앱 폴더");
    expect(purgeWork).not.toHaveBeenCalled();

    // 사유가 비어 있으면 확인 버튼이 눌리지 않습니다.
    const confirm = within(dialog).getByRole("button", { name: "완전히 삭제" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  test("사유를 적고 확인하면 사유와 함께 한 번 보내고, 목록을 다시 읽는다", async () => {
    const user = userEvent.setup();
    render(<DeletedWorkAdmin />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "완전히 삭제…" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByRole("textbox"), "회원이 완전 삭제를 요청함");
    listDeletedItems.mockResolvedValue([]);
    await user.click(within(dialog).getByRole("button", { name: "완전히 삭제" }));

    await waitFor(() => expect(purgeWork).toHaveBeenCalledWith("builder", 7, "회원이 완전 삭제를 요청함"));
    expect(await screen.findByText(/완전히 삭제했습니다/)).toBeTruthy();
    expect(listDeletedItems).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("삭제된 작업물이 없습니다.")).toBeTruthy();
  });

  test("되살리기는 그대로 — 사유 없이 확인 한 번", async () => {
    const user = userEvent.setup();
    render(<DeletedWorkAdmin />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "되살리기" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "되살리기" }));
    await waitFor(() => expect(restoreWork).toHaveBeenCalledWith("builder", 7));
    expect(purgeWork).not.toHaveBeenCalled();
  });

  test("각주는 분기 마감 때 모두 지워진다고 말한다", async () => {
    render(<DeletedWorkAdmin />);
    await screen.findByText("가계부");
    expect(screen.getByText(/모두 완전히 삭제됩니다/).textContent).toContain("분기 마감");
  });
});
