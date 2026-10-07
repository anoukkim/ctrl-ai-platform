/**
 * 접히는 사이드바 — 접은 상태가 브라우저에 남는지, 접어도 모든 메뉴에
 * 갈 수 있는지, 이름이 툴팁으로 나오는지, Admin의 기다리는 수.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/app/components/CurrentUserProvider", () => ({
  isPublicPath: () => false,
  useCurrentUser: () => ({
    state: {
      phase: "authenticated",
      user: {
        id: 1,
        username: "dev",
        display_name: "Ctrl AI Developer",
        is_admin: true,
      },
    },
    signOut: vi.fn(),
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: async () => {} }),
  useMayCreate: () => true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/AdminNavProvider", () => ({
  useAdminNav: () => ({ pendingApplications: 2, pendingTopUps: 0, isDevelopment: true }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const STORAGE_KEY = "ctrlai.sidebar-collapsed";

async function renderShell() {
  const { default: AppShell } = await import("@/app/components/AppShell");
  return render(
    <AppShell>
      <p>본문</p>
    </AppShell>,
  );
}

const NAV_NAMES = [
  "Chat",
  "Project Builder",
  "Video Generator",
  "CtrlAIApps",
  "CtrlAITube",
  "Usage",
  "Profile",
  "Report Issue",
];

describe("collapsible sidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("starts expanded, with no tooltips needed", async () => {
    await renderShell();
    expect(screen.getByRole("button", { name: "사이드바 접기" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Chat" }).getAttribute("title")).toBeNull();
  });

  test("collapsing remembers the choice, and a fresh page starts collapsed", async () => {
    const first = await renderShell();
    fireEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toBeTruthy();

    first.unmount();
    await renderShell();
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "사이드바 펼치기" }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
  });

  test("every item stays reachable when collapsed, with its name as a tooltip", async () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    await renderShell();

    for (const name of NAV_NAMES) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBeTruthy();
      expect(link.getAttribute("title")).toBe(name);
    }
    // Admin becomes a single link to the dashboard, still announcing what waits.
    const admin = screen.getByRole("link", { name: /Admin/ });
    expect(admin.getAttribute("href")).toBe("/admin");
    expect(admin.getAttribute("title")).toContain("Admin");
  });

  test("the Admin item shows how many things are waiting, open or closed", async () => {
    await renderShell();
    expect(screen.getAllByLabelText("기다리는 일 2건").length).toBeGreaterThan(0);
  });

  test("a blocked storage does not break the toggle", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await renderShell();
    fireEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toBeTruthy();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
