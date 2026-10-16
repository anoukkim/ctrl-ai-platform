/**
 * feat-notifications (owner-polish 2), cut down in owner-polish-3 (c2) — the bell.
 *
 * 종은 안 읽은 수를 달고 누르면 최근 알림이 열린다; **여는 순간 숫자가
 * 사라진다**(보이는 것을 읽음으로); 한 줄을 누르면 그 링크로 간다; "지우기"는
 * 보이는 알림을 지운다; Esc로 닫힌다. Profile에는 목록이 없다. 브라우저는
 * 알림을 만들지 않는다 — 읽고 지울 뿐.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Notification } from "@/lib/notifications";

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  unreadCount: vi.fn(),
  markAllRead: vi.fn(),
  clearNotifications: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  listNotifications: () => api.listNotifications(),
  unreadCount: () => api.unreadCount(),
  markAllRead: () => api.markAllRead(),
  clearNotifications: (ids?: number[]) => api.clearNotifications(ids),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: api.push }),
  usePathname: () => "/chat",
}));

const ROWS: Notification[] = [
  {
    id: 2,
    kind: "publish",
    title: "'오늘 할 일' 게시 완료 — v1",
    body: "이제 CtrlAIApps에서 다른 회원도 써 볼 수 있어요.",
    link: "/ctrlaistore/k3m9qx7pwa",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    read_at: null,
  },
  {
    id: 1,
    kind: "reaction",
    title: "'내 영상'이(가) 오늘 반응 2개를 얻었어요",
    body: "방금: 댓글",
    link: "/ctrlaitube/myclip",
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    read_at: new Date().toISOString(),
  },
];

/** A tiny server: the mocks read and write one list, like the real one. */
let rows: Notification[] = [];
const unread = () => rows.filter((r) => r.read_at === null).length;

beforeEach(() => {
  rows = ROWS.map((r) => ({ ...r }));
  api.listNotifications.mockReset().mockImplementation(async () => ({ items: rows, unread: unread() }));
  api.unreadCount.mockReset().mockImplementation(async () => ({ unread: unread() }));
  api.markAllRead.mockReset().mockImplementation(async () => {
    rows = rows.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() }));
    return { unread: 0 };
  });
  api.clearNotifications.mockReset().mockImplementation(async (ids?: number[]) => {
    rows = ids ? rows.filter((r) => !ids.includes(r.id)) : [];
    return { unread: unread() };
  });
  api.push.mockReset();
});

describe("종", () => {
  test("안 읽은 수를 달고, 열면 숫자가 사라지며(읽음 처리) 최근 알림이 보이고, 한 줄을 누르면 그 링크로 간다", async () => {
    const { default: NotificationBell } = await import("@/app/components/NotificationBell");
    const onNavigate = vi.fn();
    render(<NotificationBell onNavigate={onNavigate} />);
    const bell = await screen.findByRole("button", { name: "알림 — 안 읽음 1개" });
    expect(screen.getByTestId("notification-count").textContent).toBe("1");

    const user = userEvent.setup();
    await user.click(bell);
    const dialog = await screen.findByRole("dialog", { name: "알림" });
    const rowsShown = await within(dialog).findAllByRole("button", { name: /게시 완료|반응/ });
    expect(rowsShown).toHaveLength(2);
    // The rows keep their dot for this opening; the badge is gone at once.
    expect(rowsShown[0].getAttribute("data-unread")).toBe("true");
    expect(screen.queryByTestId("notification-count")).toBeNull();
    await waitFor(() => expect(api.markAllRead).toHaveBeenCalledTimes(1));

    await user.click(rowsShown[0]);
    expect(api.push).toHaveBeenCalledWith("/ctrlaistore/k3m9qx7pwa");
    expect(onNavigate).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("지우기는 보이는 알림을 지우고, Profile로 가는 링크나 모두 읽음은 없다; Esc는 창을 닫는다", async () => {
    const { default: NotificationBell } = await import("@/app/components/NotificationBell");
    render(<NotificationBell />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /알림/ }));
    const dialog = await screen.findByRole("dialog", { name: "알림" });
    await within(dialog).findAllByRole("button", { name: /게시 완료/ });
    expect(within(dialog).queryByRole("button", { name: "모두 읽음" })).toBeNull();
    expect(within(dialog).queryByRole("link", { name: /Profile/ })).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(api.clearNotifications).toHaveBeenCalledWith([2, 1]));
    expect(await within(dialog).findByText(/아직 알림이 없어요/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "지우기" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("비어 있으면 그렇게 말하고, 서버가 없어도 종은 조용히 0이다", async () => {
    api.unreadCount.mockRejectedValue(new Error("down"));
    rows = [];
    const { default: NotificationBell } = await import("@/app/components/NotificationBell");
    render(<NotificationBell />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "알림" })).toBeTruthy();
    expect(screen.queryByTestId("notification-count")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "알림" }));
    expect(await screen.findByText(/아직 알림이 없어요/)).toBeTruthy();
    expect(api.markAllRead).not.toHaveBeenCalled();
  });
});
