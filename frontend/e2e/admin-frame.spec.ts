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
    ["/admin/budget", "/admin/quarters?tab=budget", "사용 분석"],
    ["/admin/ai-models", "/admin/models", "Chat"],
    ["/admin/video-models", "/admin/models?tab=video-models", "Video"],
    ["/admin/content", "/admin/community", "신고"],
    ["/admin/feedback", "/admin/community?tab=feedback", "의견"],
    ["/admin/audit", "/admin/system?tab=audit", "감사 기록"],
  ] as const) {
    await page.goto(`${SITE}${old}`);
    await expect(page).toHaveURL(`${SITE}${landed}`);
    await expect(page.getByRole("list", { name: /안의 탭/ }).getByRole("link", { name: new RegExp(`^${tab}`) })).toHaveAttribute("aria-current", "page");
  }
  // 참여 신청 and 지운 작업 moved into Members (batch 2).
  await page.goto(`${SITE}/admin/applications?status=submitted`);
  await expect(page).toHaveURL(`${SITE}/admin/members?filter=pending&status=submitted`);
  await expect(page.getByRole("button", { name: /^승인 대기/ })).toHaveAttribute("aria-pressed", "true");
  await page.goto(`${SITE}/admin/deleted`);
  await expect(page).toHaveURL(`${SITE}/admin/members`);

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

test("batch 2: the member panel, 돈의 흐름 and 분기 마감, Models' four tabs", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/admin/members`);
  await expect(page.getByRole("button", { name: /^전체/ })).toBeVisible();
  await page.getByRole("row", { name: new RegExp(`@${USER}`) }).first().click();
  const panel = page.getByTestId("member-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("member-deleted-work")).toBeVisible();
  await expect(panel.getByTestId("member-usage")).toContainText("사용률");
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-member-panel.png` });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  await page.goto(`${SITE}/admin/quarters`);
  await expect(page.getByTestId("money-flow")).toBeVisible();
  await expect(page.getByTestId("close-stepper")).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByTestId("money-flow").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/1440-dark-quarters.png` });

  // Batch 3: 사용 분석.
  await page.goto(`${SITE}/admin/quarters?tab=budget`);
  await expect(page.getByTestId("usage-analysis")).toBeVisible();
  await expect(page.getByRole("link", { name: /Concur/ })).toHaveCount(0); // inside the closed 내보내기 fold
  await page.screenshot({ path: `${SHOTS}/1440-dark-usage-analysis.png` });

  await page.goto(`${SITE}/admin/models`);
  const tabs = page.getByRole("list", { name: /안의 탭/ }).getByRole("link");
  await expect(tabs).toHaveText(["Chat", "Video", "한도", "보정"]);
  await page.goto(`${SITE}/admin/models?tab=limits`);
  await expect(page.getByRole("heading", { name: "채팅 한도" })).toBeVisible();
  await page.goto(`${SITE}/admin/community`);
  await expect(page.getByRole("list", { name: /안의 탭/ }).getByRole("link")).toHaveText([/^신고/, "의견", "앱"]);
  await page.goto(`${SITE}/admin/system`);
  await expect(page.getByTestId("health-strip")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1440-dark-system.png` });
});


test("batch 4: 공지 띠 follows System on every page; 백업 and 알림 기준 are in System", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const reset = () =>
    page.context().request.put(`${SITE}/api/admin/site/banner`, { data: { shown: false, text: "", feedback_link: true } });
  try {
    await page.goto(`${SITE}/admin/system`);
    await expect(page.getByTestId("health-strip")).toContainText("백업");
    await page.getByRole("button", { name: /공지 띠/ }).click();
    const panel = page.getByTestId("banner-panel");
    await panel.getByTestId("banner-shown").check();
    await panel.getByLabel(/문구/).fill("10월 25일 밤 점검이 있어요");
    await panel.getByTestId("banner-feedback").uncheck();
    await panel.getByRole("button", { name: "저장" }).click();
    await expect(panel.getByRole("status")).toContainText("저장했어요");

    await page.goto(`${SITE}/usage`);
    const strip = page.getByRole("region", { name: /공지|베타 안내/ });
    await expect(strip).toContainText("10월 25일 밤 점검이 있어요");
    await expect(strip.getByRole("button", { name: "의견 보내기" })).toHaveCount(0);
    await theme(page, "dark");
    await page.screenshot({ path: `${SHOTS}/1440-dark-banner.png` });

    await reset();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: /공지|베타 안내/ })).toHaveCount(0);

    await page.goto(`${SITE}/admin/system`);
    await page.getByRole("button", { name: /알림 기준/ }).click();
    await expect(page.getByTestId("alerts-panel").getByLabel(/지원금을 이만큼/)).toHaveValue(/\d+/);
  } finally {
    await reset();
  }
});
