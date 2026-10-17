/**
 * admin-consolidation v3 (1) — the Admin frame in a real browser.
 *
 * Six sections as tabs, the former sections as tabs inside, every former
 * address landing on its new place, the Dashboard's 처리할 일 / 알림 /
 * 이번 주, and the header search (⌘K). Screenshots →
 * docs/progress/screens/admin-consolidation/.
 */

import { expect, test, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";
const SHOTS = "../docs/progress/screens/admin-consolidation";

test.use({ actionTimeout: 20_000 });

async function login(page: Page) {
  const login = await page.context().request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  await page.addInitScript(() => window.localStorage.setItem("ctrlai.guide-done", "1"));
}

async function theme(page: Page, name: "light" | "dark") {
  await page.evaluate((t) => {
    window.localStorage.setItem("ctrlai-theme", t);
    document.documentElement.dataset.theme = t;
  }, name);
  await page.waitForTimeout(400);
}

test("six sections, tabs inside, old addresses land in the new place, search finds a member", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/admin`);
  const tabs = page.getByRole("navigation", { name: "현재 위치" }).locator("xpath=following-sibling::*[1]").getByRole("link");
  await expect(tabs.first()).toBeVisible();
  const names = (await tabs.allInnerTexts()).map((text) => text.replace(/\d+$/, "").trim());
  expect(names).toEqual(["Dashboard", "Members", "Quarters", "Models", "Community", "System"]);
  await expect(page.getByRole("heading", { name: "처리할 일" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /알림/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "이번 주 가장 많이 쓴 곳" })).toBeVisible();
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-dashboard.png` });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-dashboard.png` });

  for (const [old, landed, tab] of [
    ["/admin/applications?status=submitted", "/admin/members?tab=applications&status=submitted", "참여 신청"],
    ["/admin/budget", "/admin/quarters?tab=budget", "예산"],
    ["/admin/ai-models", "/admin/models", "Chat"],
    ["/admin/video-models", "/admin/models?tab=video-models", "Video"],
    ["/admin/content", "/admin/community", "신고"],
    ["/admin/feedback", "/admin/community?tab=feedback", "의견"],
    ["/admin/deleted", "/admin/community?tab=deleted", "지운 작업"],
    ["/admin/audit", "/admin/system?tab=audit", "감사 기록"],
  ] as const) {
    await page.goto(`${SITE}${old}`);
    await expect(page).toHaveURL(`${SITE}${landed}`);
    await expect(page.getByRole("list", { name: /안의 탭/ }).getByRole("link", { name: new RegExp(`^${tab}`) })).toHaveAttribute("aria-current", "page");
  }
  await page.goto(`${SITE}/admin/community?tab=feedback`);
  await expect(page.getByRole("list", { name: /안의 탭/ })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/1440-dark-community-tabs.png` });

  // ⌘K: the header search finds the dev member and opens their detail.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(USER);
  const option = page.getByRole("option").first();
  await expect(option).toContainText(`@${USER}`);
  await page.screenshot({ path: `${SHOTS}/1440-dark-search.png` });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/members\/\d+(\?quarter=\d+)?$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await theme(page, "light");
  await page.goto(`${SITE}/admin`);
  await expect(page.getByRole("heading", { name: "처리할 일" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/390-light-dashboard.png`, fullPage: true });
});
