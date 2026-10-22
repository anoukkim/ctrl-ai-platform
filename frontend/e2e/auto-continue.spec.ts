/**
 * feat-auto-continue (owner-polish 11) — in a real browser against the local
 * stack with mock Claude (CHAT_MOCK_DELAY_MS=25 so the stream is watchable).
 *
 * A 3,000-character mock reply under a 1,024-token 보통 room stops at the
 * cap twice; the server continues by itself. The screen shows "이어서 쓰는
 * 중… 지금까지 N원" with 중지 still there, then one bubble whose html block
 * is whole — the preview opens (no "끝까지 오지 않아" note) and the head says
 * 3번에 나눠 씀. The admin's 채팅 한도 row is set through the API first and
 * restored after. Screenshots → docs/progress/screens/auto-continue/.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";
const SHOTS = "../docs/progress/screens/auto-continue";

test.use({ actionTimeout: 20_000 });

async function login(page: Page) {
  const login = await page.context().request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
}

async function theme(page: Page, name: "light" | "dark") {
  await page.evaluate((t) => {
    window.localStorage.setItem("ctrlai-theme", t);
    document.documentElement.dataset.theme = t;
  }, name);
}

type Limits = Record<string, unknown> & { depth_levels: Record<string, Record<string, Record<string, number>>> };

async function readLimits(request: APIRequestContext): Promise<Limits> {
  return (await (await request.get(`${SITE}/api/admin/claude-pricing`)).json()).chat_limits as Limits;
}

async function writeLimits(request: APIRequestContext, limits: Limits, medium: Record<string, number>) {
  const keys = [
    "reply_cap_krw", "long_history_tokens", "daily_cap_krw", "provider_concurrency", "web_fetch_max_uses",
    "web_fetch_max_content_tokens", "web_search_max_uses", "app_ai_daily_cap_krw", "context_tokens", "timeout_seconds",
  ];
  const payload: Record<string, unknown> = {};
  for (const key of keys) payload[key] = limits[key];
  const levels = JSON.parse(JSON.stringify(limits.depth_levels));
  levels.chat.medium = { ...levels.chat.medium, ...medium };
  const response = await request.post(`${SITE}/api/admin/claude-pricing/chat-limits`, { data: { ...payload, depth_levels: levels } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test("a long reply is continued by the server into one bubble, and the preview opens", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("ctrlai.guide-done", "1"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await readLimits(page.context().request);
  const medium = before.depth_levels.chat.medium;
  await writeLimits(page.context().request, before, { max_tokens: 1024, cap_krw: 200, total_cap_krw: 1500 });
  try {
    await page.goto(`${SITE}/`); // Chat is the opening screen
    const box = page.getByLabel("CTRL+AI에게 보낼 메시지");
    await box.fill("[mock-long:3000]");
    await box.press("Enter");

    // The server goes on by itself; 중지 stays available.
    const continuing = page.getByTestId("continuing");
    await expect(continuing).toBeVisible({ timeout: 60_000 });
    await expect(continuing).toContainText(/이어서 쓰는 중… \(\d번째\) · 지금까지 \d+원/);
    await expect(page.getByRole("button", { name: "중지" })).toBeVisible();
    await theme(page, "light");
    await page.screenshot({ path: `${SHOTS}/1440-light-continuing.png` });

    // One reply, three calls, a whole code block → the preview opens.
    const head = page.getByTestId("reply-model");
    await expect(head).toContainText("3번에 나눠 씀", { timeout: 120_000 });
    await expect(page.getByTestId("continuing")).toHaveCount(0);
    await expect(page.getByTestId("continue-reply")).toHaveCount(0);
    await expect(page.getByTestId("artifact-cut-off")).toHaveCount(0);
    // chat-artifact-panel: the reply is a card; pressing it opens the result in the side panel.
    const open = page.getByTestId("artifact").first();
    await expect(open).toBeVisible();
    await open.click();
    await expect(page.locator("iframe[sandbox='allow-scripts']")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/1440-light-merged-preview.png` });
    await theme(page, "dark");
    await page.screenshot({ path: `${SHOTS}/1440-dark-merged-preview.png` });

    // The ledger holds three rows for the one reply, newest first, all for this conversation.
    const usage = (await (await page.context().request.get(`${SITE}/api/usage/me`)).json()) as { events: { label: string; charged_krw: number }[] };
    const newest = usage.events.slice(0, 3);
    expect(newest).toHaveLength(3);
    expect(newest.every((e) => e.charged_krw > 0 && e.label === newest[0].label)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await theme(page, "light");
    await page.screenshot({ path: `${SHOTS}/390-light-merged.png`, fullPage: true });
  } finally {
    await writeLimits(page.context().request, before, medium);
  }
});
