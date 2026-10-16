/**
 * DialogShell — 모든 창의 껍데기 (fix-ui-polish-admin).
 *
 * 증명하는 것:
 *   - 창은 연 단추 옆이 아니라 `document.body`에 그려진다. 그래야 베타
 *     배너(줄바꿈 금지)처럼 부모의 글자 규칙을 물려받지 않는다.
 *   - 배경을 누르거나 Esc를 누르면 닫힌다.
 *   - 의견 보내기의 두 입구 — 베타 배너와 사이드바 — 가 같은 창을 연다.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DialogShell from "@/app/components/DialogShell";

vi.mock("@/app/components/SiteProvider", () => ({
  useSiteLoaded: () => true,
  useSite: () => ({ is_beta: true, top_ups_enabled: false, test_mode: {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/CurrentUserProvider", () => ({
  isPublicPath: () => false,
  useCurrentUser: () => ({
    state: {
      phase: "authenticated",
      user: { id: 2, username: "pw_member", display_name: "회원", is_admin: false },
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
  useAdminNav: () => ({ pendingApplications: 0, pendingTopUps: 0, isDevelopment: false }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  window.localStorage.clear();
  // The first-visit guide is a dialog too; keep it out of these tests.
  window.localStorage.setItem("ctrlai.guide-done", "1");
});

/** The open dialog's backdrop must be a direct child of <body>. */
function expectInBody(dialog: HTMLElement, opener: HTMLElement) {
  expect(dialog.parentElement?.parentElement).toBe(document.body);
  expect(opener.contains(dialog)).toBe(false);
}

describe("DialogShell", () => {
  test("renders into document.body and closes on a backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <div style={{ whiteSpace: "nowrap" }}>
        <DialogShell onClose={onClose} labelledBy="t">
          <h2 id="t">창</h2>
        </DialogShell>
      </div>,
    );

    const dialog = screen.getByRole("dialog", { name: "창" });
    expectInBody(dialog, container);

    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    // A click inside the panel is not a backdrop click.
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("의견 보내기 — both entry points open the same dialog", () => {
  async function openFromBanner() {
    const { default: BetaBanner } = await import("@/app/components/BetaBanner");
    const view = render(<BetaBanner />);
    fireEvent.click(screen.getByRole("button", { name: "의견 보내기" }));
    return { view, dialog: screen.getByRole("dialog", { name: "의견 보내기" }) };
  }

  async function openFromSidebar() {
    const { default: AppShell } = await import("@/app/components/AppShell");
    const view = render(
      <AppShell>
        <p>본문</p>
      </AppShell>,
    );
    const nav = document.getElementById("primary-navigation") as HTMLElement;
    const button = [...nav.querySelectorAll("button")].find(
      (element) => element.getAttribute("aria-label") === "의견 보내기",
    ) as HTMLElement;
    fireEvent.click(button);
    return { view, dialog: screen.getByRole("dialog", { name: "의견 보내기" }) };
  }

  test("from the banner: in document.body, Escape closes it", async () => {
    const { view, dialog } = await openFromBanner();
    expectInBody(dialog, view.container);
    expect(screen.getByLabelText("내용").tagName).toBe("TEXTAREA");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("from the sidebar: in document.body, Escape closes it", async () => {
    const { view, dialog } = await openFromSidebar();
    expectInBody(dialog, view.container);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the two entry points render the same dialog", async () => {
    const banner = await openFromBanner();
    const bannerShape = {
      className: banner.dialog.className,
      text: banner.dialog.textContent,
    };
    fireEvent.keyDown(window, { key: "Escape" });
    banner.view.unmount();

    const sidebar = await openFromSidebar();
    expect(sidebar.dialog.className).toBe(bannerShape.className);
    expect(sidebar.dialog.textContent).toBe(bannerShape.text);
  });
});
