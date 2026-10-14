/**
 * 접히는 사이드바 — 접은 상태가 브라우저에 남는지, 접어도 모든 메뉴에
 * 갈 수 있는지, 이름이 툴팁으로 나오는지, Admin의 기다리는 수.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The signed-in user; a test switches it to a member.
const who = vi.hoisted(() => ({
  user: {
    id: 1,
    username: "dev",
    display_name: "Ctrl AI Developer",
    is_admin: true,
  },
}));

vi.mock("@/app/components/CurrentUserProvider", () => ({
  isPublicPath: () => false,
  useCurrentUser: () => ({
    state: { phase: "authenticated", user: who.user },
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
];

const ADMIN = { ...who.user };
const MEMBER = { id: 2, username: "pw_member", display_name: "회원", is_admin: false };

/** The group headings in the order they appear. */
function groupHeadings(): string[] {
  return ["Create", "Explore", "Manage", "Account"].filter((name) => screen.queryByText(name));
}

describe("sidebar groups (owner decision 2026-10-14)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("an admin sees Create, Explore, Manage, Account in that order, Admin under Manage", async () => {
    who.user = ADMIN;
    const { container } = await renderShell();

    const order = ["Create", "Explore", "Manage", "Account"].map((name) =>
      container.innerHTML.indexOf(`>${name}<`),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const manage = screen.getByText("Manage").parentElement as HTMLElement;
    expect(manage.textContent).toContain("Admin");
    expect(screen.getByText("관리자")).toBeTruthy();
  });

  test("a member never sees Manage, Admin or the 관리자 badge", async () => {
    who.user = MEMBER;
    await renderShell();

    expect(groupHeadings()).toEqual(["Create", "Explore", "Account"]);
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("관리자")).toBeNull();
    who.user = ADMIN;
  });

  test("Usage and Profile are ordinary items with an icon and a label, like Chat", async () => {
    who.user = ADMIN;
    await renderShell();

    // The same base item class as Chat — not a separate compact style.
    const base = (name: string) => screen.getByRole("link", { name }).className.split(" ")[0];
    for (const name of ["Chat", "Usage", "Profile"]) {
      const link = screen.getByRole("link", { name });
      expect(link.querySelector("svg")).toBeTruthy();
      expect(link.textContent).toBe(name);
      expect(base(name)).toBe(base("CtrlAITube"));
    }
  });
});

describe("collapsible sidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
    who.user = ADMIN;
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

  test("the footer links the privacy policy and terms (privacy-and-terms)", async () => {
    await renderShell();
    expect(screen.getByRole("link", { name: "개인정보" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "약관" }).getAttribute("href")).toBe("/terms");

    // The collapsed rail has no room for them; they come back on expand.
    fireEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(screen.queryByRole("link", { name: "개인정보" })).toBeNull();
  });
});
