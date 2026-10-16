/**
 * 접히는 사이드바 — 접은 상태가 브라우저에 남는지, 접어도 모든 메뉴에
 * 갈 수 있는지, 이름이 툴팁으로 나오는지, Admin의 기다리는 수.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
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
];

const ADMIN = { ...who.user };
const MEMBER = { id: 2, username: "pw_member", display_name: "회원", is_admin: false };

/** The group headings in the order they appear. */
function groupHeadings(): string[] {
  return ["Create", "Explore", "Manage", "Account"].filter((name) => screen.queryByText(name, { selector: "p" }));
}

describe("sidebar groups (owner decision 2026-10-14)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("an admin sees Create, Explore, Manage in that order, Admin under Manage (no Account group since 2026-10-17)", async () => {
    who.user = ADMIN;
    const { container } = await renderShell();

    expect(groupHeadings()).toEqual(["Create", "Explore", "Manage"]);
    const order = ["Create", "Explore", "Manage"].map((name) =>
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

    expect(groupHeadings()).toEqual(["Create", "Explore"]);
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("관리자")).toBeNull();
    who.user = ADMIN;
  });

  test("Usage and Profile live only in the account menu, not as sidebar items (owner, 2026-10-17)", async () => {
    who.user = ADMIN;
    await renderShell();

    expect(screen.queryByRole("link", { name: "Usage" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Profile" })).toBeNull();
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
      // A locked item (Video Generator while owner-polish 6 holds) adds its
      // reason after the name; every other tooltip is the name alone.
      if (link.dataset.locked === "true") expect(link.getAttribute("title")).toBe(`${name} — 다음 단계에서 열려요`);
      else expect(link.getAttribute("title")).toBe(name);
    }
    // Admin becomes a single link to the dashboard, still announcing what waits.
    const admin = screen.getByRole("link", { name: /Admin/ });
    expect(admin.getAttribute("href")).toBe("/admin");
    expect(admin.getAttribute("title")).toContain("Admin");
  });

  test("Video Generator carries a lock and '다음 단계에서 열려요' while the site says it is closed (owner-polish 6)", async () => {
    who.user = MEMBER;
    await renderShell();

    const video = screen.getByRole("link", { name: "Video Generator" });
    expect(video.dataset.locked).toBe("true");
    expect(video.getAttribute("href")).toBe("/video"); // still a link — the screen explains
    expect(video.textContent).toContain("다음 단계에서 열려요");
    expect(video.getAttribute("aria-describedby")).toBeTruthy();
    // No other item is locked.
    for (const name of NAV_NAMES.filter((n) => n !== "Video Generator")) {
      expect(screen.getByRole("link", { name }).dataset.locked).toBeUndefined();
    }
    who.user = ADMIN;
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

  test("owner-polish-3 (c2): the bell sits in the header, the account row opens a menu, the footer holds only the legal links", async () => {
    await renderShell();
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    // The bell is in the brand row, before the collapse button; no icon strip at the bottom.
    const bell = within(nav).getByRole("button", { name: /^알림/ });
    expect(bell.compareDocumentPosition(screen.getByRole("button", { name: "사이드바 접기" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(nav).queryByRole("button", { name: "로그아웃" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: /화면으로$/ })).toBeNull();

    // The account row is a menu: Profile · Usage · theme · 처음 안내 · 의견 보내기 · 로그아웃.
    const account = within(nav).getByRole("button", { name: /Ctrl AI Developer — 계정 메뉴/ });
    fireEvent.click(account);
    const menu = screen.getByRole("menu");
    const labels = within(menu).getAllByRole("menuitem").map((item) => item.textContent ?? "");
    expect(labels.some((text) => text.startsWith("Profile"))).toBe(true);
    expect(labels.some((text) => text.startsWith("Usage"))).toBe(true);
    expect(labels.some((text) => /화면으로/.test(text))).toBe(true);
    expect(labels.some((text) => text.startsWith("처음 안내"))).toBe(true);
    expect(labels.some((text) => text.startsWith("의견 보내기"))).toBe(true);
    expect(labels[labels.length - 1].startsWith("로그아웃")).toBe(true);
    // One line each — an icon and the name, no grey second line (owner, 2026-10-17).
    expect(labels).toEqual(["Profile", "Usage", expect.stringMatching(/화면으로$/), "처음 안내 다시 보기", "의견 보내기", "로그아웃"]);
    for (const item of within(menu).getAllByRole("menuitem")) expect(item.querySelector("svg")).toBeTruthy();

    // Collapsed: the avatar still opens the menu; the legal links hide.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(within(nav).getByRole("button", { name: /계정 메뉴/ })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: /^알림/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "약관" })).toBeNull();
  });
});
