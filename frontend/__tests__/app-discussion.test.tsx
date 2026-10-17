/**
 * ctrlaiapps-reactions — the 반응·댓글 panel beside a published app.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = {
  getApp: vi.fn(),
  getAppDiscussion: vi.fn(),
  toggleAppReaction: vi.fn(),
  addAppComment: vi.fn(),
};
vi.mock("@/lib/apps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apps")>();
  return {
    ...actual,
    getApp: (...args: unknown[]) => api.getApp(...args),
    getAppDiscussion: (...args: unknown[]) => api.getAppDiscussion(...args),
    toggleAppReaction: (...args: unknown[]) => api.toggleAppReaction(...args),
    addAppComment: (...args: unknown[]) => api.addAppComment(...args),
  };
});
vi.mock("@/app/components/ToastProvider", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({
    state: { phase: "authenticated", user: { username: "yurikim", display_name: "김유리", is_admin: false } },
  }),
}));
vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMyQuarter: () => ({ state: { phase: "ready", quarter: { membership_status: "active" } } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/ctrlaistore/abcdefgh23",
  useSearchParams: () => new URLSearchParams(),
}));

const APP = {
  id: 5,
  slug: "abcdefgh23",
  name: "동아리 게시판",
  description: "글을 올려요",
  author_name: "민지",
  author_username: "minji",
  version_number: 3,
  published_at: new Date().toISOString(),
  publish_note: "",
  app_url: "http://apps.test/abcdefgh23/",
  shared_lists: false,
};
const EMPTY = { reactions: { like: 0, useful: 0, interesting: 0 }, my_reactions: [], comment_count: 0, comments: [] };

const { default: AppDetail, PANEL_STORAGE_KEY } = await import("@/app/ctrlaistore/[slug]/AppDetail");

describe("AppDetail › 반응·댓글", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    window.localStorage.removeItem(PANEL_STORAGE_KEY);
    api.getApp.mockResolvedValue(APP);
    api.getAppDiscussion.mockResolvedValue(EMPTY);
  });

  test("the panel sits beside the app with reactions and comments; a reaction toggles on the server", async () => {
    api.toggleAppReaction.mockResolvedValue({ ...EMPTY, reactions: { like: 1, useful: 0, interesting: 0 }, my_reactions: ["like"] });
    render(<AppDetail slug="abcdefgh23" />);
    const panel = await screen.findByRole("complementary", { name: "반응과 댓글" });
    await waitFor(() => expect(api.getAppDiscussion).toHaveBeenCalledWith("abcdefgh23"));
    await waitFor(() => expect(panel.textContent).toContain("댓글 0"));
    const like = await screen.findByRole("button", { name: /좋아요/ });
    fireEvent.click(like);
    await waitFor(() => expect(api.toggleAppReaction).toHaveBeenCalledWith("abcdefgh23", "like"));
    await waitFor(() => expect(screen.getByRole("button", { name: /좋아요/ }).textContent).toContain("1"));
  });

  test("the panel folds and the choice is remembered", async () => {
    const { container } = render(<AppDetail slug="abcdefgh23" />);
    const fold = await screen.findByRole("button", { name: "반응·댓글 접기" });
    fireEvent.click(fold);
    expect(window.localStorage.getItem(PANEL_STORAGE_KEY)).toBe("1");
    expect(container.querySelector("[data-panel-collapsed]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "반응·댓글 펼치기" }).getAttribute("aria-expanded")).toBe("false");
  });
});
