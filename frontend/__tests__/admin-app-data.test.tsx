/**
 * app-platform P3 — 앱의 ctrlai.db 데이터 (P4b부터 Admin › Apps › 앱 상세에서).
 *
 * "공유 데이터 보기"로 시트를 열면 목록과 공유 항목이 보이고, 숨기기/지우기는
 * 사유를 적어야 보내집니다. 공유 항목 하나를 신고한 건은 Content의 신고 표에
 * 내용 일부와 "항목 숨기기"가 나옵니다.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import AdminContentPage from "@/app/admin/content/ContentAdmin";
import AppDetailView from "@/app/admin/apps/[id]/AppDetailView";
import { formatBytes } from "@/lib/apps";

const listAdminApps = vi.fn();
const getAdminApp = vi.fn();
const listAppReports = vi.fn();
const getAdminAppData = vi.fn();
const adminDataItem = vi.fn();

vi.mock("@/lib/apps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apps")>();
  return {
    ...actual,
    listAdminApps: () => listAdminApps(),
    getAdminApp: () => getAdminApp(),
    listAppReports: () => listAppReports(),
    getAdminAppData: (...args: unknown[]) => getAdminAppData(...args),
    adminDataItem: (...args: unknown[]) => adminDataItem(...args),
  };
});

// promo-videos: Content also lists CtrlAITube comment reports — none here.
vi.mock("@/lib/tube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tube")>();
  return { ...actual, listTubeReports: () => Promise.resolve([]) };
});

vi.mock("@/app/components/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

const APP = {
  id: 5,
  slug: "abcdefgh23",
  name: "동아리 게시판",
  description: "",
  author_name: "민지",
  version_number: 2,
  published_at: new Date().toISOString(),
  owner_id: 2,
  open_reports: 1,
  example: false,
  sdk_enabled: true,
  sdk_disabled_reason: "",
  data_items: 12,
  data_bytes: 3 * 1024,
};

/** Apps 상세가 읽는 모양 (P4b). */
const OVERVIEW = {
  ...APP,
  published: true,
  app_url: "http://apps.test/abcdefgh23/",
  owner_username: "minji",
  owner_name: "민지",
  consents: 3,
  ai: { today_calls: 2, today_krw: 24, quarter_calls: 9, quarter_krw: 110, preview_quarter_calls: 1, preview_quarter_krw: 7 },
  updated_at: new Date().toISOString(),
};

const REPORT = {
  id: 9,
  project_id: 5,
  app_name: "동아리 게시판",
  app_slug: "abcdefgh23",
  reason: "욕설이에요",
  reporter_username: "dev",
  created_at: new Date().toISOString(),
  still_listed: true,
  data_item_id: 31,
  item_excerpt: '{"text": "이상한 글"}',
  item_live: true,
};

const DATA = {
  items: 12,
  bytes: 3 * 1024,
  collections: [
    { name: "board", kind: "shared", items: 10, bytes: 2900 },
    { name: "notes", kind: "private", items: 2, bytes: 172 },
  ],
  shared: [
    {
      id: 31,
      collection: "board",
      data: { text: "이상한 글" },
      size_bytes: 40,
      author_username: "minji",
      created_at: new Date().toISOString(),
      open_reports: 1,
    },
  ],
};

beforeEach(() => {
  listAdminApps.mockReset().mockResolvedValue([APP]);
  getAdminApp.mockReset().mockResolvedValue(OVERVIEW);
  listAppReports.mockReset().mockResolvedValue([REPORT]);
  getAdminAppData.mockReset().mockResolvedValue(DATA);
  adminDataItem.mockReset().mockResolvedValue({ detail: "항목을 숨겼습니다.", reports_closed: 1 });
});

describe("formatBytes", () => {
  test("B · KB · MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3 * 1024)).toBe("3.0 KB");
    expect(formatBytes(120 * 1024)).toBe("120 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("Admin › Apps › 공유 데이터", () => {
  test("데이터 칸으로 시트를 열면 목록과 공유 항목이 보인다", async () => {
    const user = userEvent.setup();
    render(<AppDetailView projectId={5} />);
    expect((await screen.findByTestId("app-ai")).textContent).toContain("2회 · 24원");
    expect(screen.getByTestId("app-ai").textContent).toContain("1회 · 7원");

    const open = await screen.findByRole("button", { name: "공유 데이터 보기" });
    await user.click(open);

    const sheet = await screen.findByRole("dialog", { name: "데이터 — 동아리 게시판" });
    expect(getAdminAppData).toHaveBeenCalledWith(5);
    const collections = await within(sheet).findByTestId("data-collections");
    expect(collections.textContent).toContain("board");
    expect(collections.textContent).toContain("공유");
    expect(collections.textContent).toContain("개인");
    const shared = within(sheet).getByTestId("data-shared");
    expect(shared.textContent).toContain("이상한 글");
    expect(shared.textContent).toContain("minji");
    expect(shared.textContent).toContain("신고 1");
  });

  test("숨기기는 사유 없이는 보내지지 않고, 사유를 적으면 보내고 다시 읽는다", async () => {
    const user = userEvent.setup();
    render(<AppDetailView projectId={5} />);
    await user.click(await screen.findByRole("button", { name: "공유 데이터 보기" }));
    const sheet = await screen.findByRole("dialog", { name: "데이터 — 동아리 게시판" });
    await within(sheet).findByTestId("data-shared");

    await user.click(within(sheet).getByRole("button", { name: "숨기기" }));
    const form = within(sheet).getByRole("form", { name: "숨기기 확인" });
    await user.click(within(form).getByRole("button", { name: "숨기기" }));
    expect(adminDataItem).not.toHaveBeenCalled();
    expect(within(form).getByRole("alert").textContent).toContain("사유");

    await user.type(within(form).getByRole("textbox"), "욕설");
    await user.click(within(form).getByRole("button", { name: "숨기기" }));
    await waitFor(() => expect(adminDataItem).toHaveBeenCalledWith(31, "hide", "욕설"));
    await waitFor(() => expect(getAdminAppData).toHaveBeenCalledTimes(2));
    expect(getAdminApp).toHaveBeenCalledTimes(2);
  });

  test("지우기는 빨간 단추로, 같은 흐름", async () => {
    const user = userEvent.setup();
    render(<AppDetailView projectId={5} />);
    await user.click(await screen.findByRole("button", { name: "공유 데이터 보기" }));
    const sheet = await screen.findByRole("dialog", { name: "데이터 — 동아리 게시판" });
    await within(sheet).findByTestId("data-shared");

    await user.click(within(sheet).getByRole("button", { name: "지우기" }));
    const form = within(sheet).getByRole("form", { name: "지우기 확인" });
    expect(form.textContent).toContain("완전히 지워져요");
    await user.type(within(form).getByRole("textbox"), "광고");
    await user.click(within(form).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(adminDataItem).toHaveBeenCalledWith(31, "delete", "광고"));
  });

  test("공유 항목 신고는 내용 일부와 '항목 숨기기'를 보여 준다", async () => {
    const user = userEvent.setup();
    render(<AdminContentPage />);

    const excerpt = await screen.findByTestId("report-excerpt");
    expect(excerpt.textContent).toContain('{"text": "이상한 글"}');
    await user.click(screen.getByRole("button", { name: "항목 숨기기" }));
    const confirm = await screen.findByRole("dialog", { name: "신고된 항목 숨기기" });
    expect(confirm.textContent).toContain("이상한 글");
  });

  test("이미 숨긴 항목의 신고에는 단추가 없다", async () => {
    listAppReports.mockResolvedValue([{ ...REPORT, item_live: false }]);
    render(<AdminContentPage />);
    const excerpt = await screen.findByTestId("report-excerpt");
    expect(excerpt.textContent).toContain("이미 숨기거나 지웠어요");
    expect(screen.queryByRole("button", { name: "항목 숨기기" })).toBeNull();
  });
});
