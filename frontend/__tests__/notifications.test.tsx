/**
 * feat-notifications (owner-polish 2) — 종, 그 창, Profile의 목록.
 *
 * 종은 안 읽은 수를 달고 누르면 최근 알림이 열린다; 한 줄을 누르면 읽음으로
 * 표시되고 그 링크로 간다; "모두 읽음"은 숫자를 0으로; Esc로 닫힌다.
 * Profile 목록은 같은 줄을 쓰고 점으로 안 읽음을 보여 준다. 브라우저는
 * 알림을 만들지 않는다 — 읽고 표시할 뿐.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Notification } from "@/lib/notifications";

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  unreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  listNotifications: () => api.listNotifications(),
  unreadCount: () => api.unreadCount(),
  markRead: (id: number) => api.markRead(id),
  markAllRead: () => api.markAllRead(),
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
    kind: "spend",
    title: "어제 지원금 500원 사용",
    body: "채팅 2회 · 빌더 1회",
    link: "/usage",
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
  api.markRead.mockReset().mockImplementation(async (id: number) => {
    const row = rows.find((r) => r.id === id)!;
    row.read_at = new Date().toISOString();
    return row;
  });
  api.markAllRead.mockReset().mockImplementation(async () => {
    rows = rows.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() }));
    return { unread: 0 };
  });
  api.push.mockReset();
});

describe("종", () => {
  test("안 읽은 수를 달고, 열면 최근 알림이 보이고, 한 줄을 누르면 읽음 + 그 링크로 간다", async () => {
    const { default: NotificationBell } = await import("@/app/components/NotificationBell");
    const onNavigate = vi.fn();
    render(<NotificationBell onNavigate={onNavigate} />);
    const bell = await screen.findByRole("button", { name: "알림 — 안 읽음 1개" });
    expect(screen.getByTestId("notification-count").textContent).toBe("1");

    const user = userEvent.setup();
    await user.click(bell);
    const dialog = await screen.findByRole("dialog", { name: "알림" });
    const rows = await within(dialog).findAllByRole("button", { name: /게시 완료|지원금/ });
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-unread")).toBe("true");
    expect(rows[1].getAttribute("data-unread")).toBeNull();

    await user.click(rows[0]);
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith(2));
    expect(api.push).toHaveBeenCalledWith("/ctrlaistore/k3m9qx7pwa");
    expect(onNavigate).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("notification-count")).toBeNull());
  });

  test("모두 읽음은 숫자를 0으로 만들고, Esc는 창을 닫는다; 읽은 줄은 다시 요청하지 않는다", async () => {
    const { default: NotificationBell } = await import("@/app/components/NotificationBell");
    render(<NotificationBell />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /알림/ }));
    const dialog = await screen.findByRole("dialog", { name: "알림" });
    await within(dialog).findAllByRole("button", { name: /게시 완료/ });
    await user.click(within(dialog).getByRole("button", { name: "모두 읽음" }));
    await waitFor(() => expect(api.markAllRead).toHaveBeenCalled());
    expect(screen.queryByTestId("notification-count")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "모두 읽음" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: /지원금/ }));
    expect(api.markRead).not.toHaveBeenCalled();
    expect(api.push).toHaveBeenCalledWith("/usage");

    await user.click(screen.getByRole("button", { name: /알림/ }));
    await screen.findByRole("dialog");
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
  });
});

describe("Profile › 알림 목록", () => {
  test("최근 순으로, 안 읽은 줄은 점, 누르면 읽음, 모두 읽음", async () => {
    const { default: NotificationFeed } = await import("@/app/profile/NotificationFeed");
    render(<NotificationFeed />);
    const feed = await screen.findByTestId("notification-feed");
    expect(within(feed).getByText("안 읽음 1개")).toBeTruthy();
    const rows = within(feed).getAllByRole("button", { name: /게시 완료|지원금/ });
    expect(rows[0].textContent).toContain("게시 완료");
    expect(rows[0].getAttribute("data-unread")).toBe("true");

    const user = userEvent.setup();
    await user.click(rows[0]);
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith(2));
    expect(api.push).toHaveBeenCalledWith("/ctrlaistore/k3m9qx7pwa");
    await waitFor(() => expect(within(feed).getByText("모두 읽었어요")).toBeTruthy());
    expect((within(feed).getByRole("button", { name: "모두 읽음" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("빈 목록은 안내 한 줄", async () => {
    rows = [];
    const { default: NotificationFeed } = await import("@/app/profile/NotificationFeed");
    render(<NotificationFeed />);
    expect(await screen.findByText(/아직 알림이 없어요/)).toBeTruthy();
  });
});
