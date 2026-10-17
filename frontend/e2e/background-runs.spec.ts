/**
 * background-runs — a reply outlives its page, in a real browser.
 *
 * Mock Claude with CHAT_MOCK_DELAY_MS=25: a 3,000-character reply takes a
 * dozen seconds. The member sends, leaves for Project Builder (the Chat
 * item keeps its running dot), reloads (the dot now comes from the
 * server), comes back and opens the conversation: the reply is shown with
 * the text so far and followed to the end; the server saved it whole and
 * charged it once. Screenshots → docs/progress/screens/background-runs/.
 */

import { expect, test, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";
const SHOTS = "../docs/progress/screens/background-runs";

test.use({ actionTimeout: 20_000 });

async function login(page: Page) {
  const login = await page.context().request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  await page.addInitScript(() => window.localStorage.setItem("ctrlai.guide-done", "1"));
}

type Detail = { id: number; title: string; messages: { role: string; status: string; content: string }[]; running: unknown };

test("leaving Chat mid-reply: it goes on, the dot stays (from the server), coming back follows it to the end", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/`);
  const box = page.getByLabel("CTRL+AI에게 보낼 메시지");
  const tag = `백그라운드 e2e ${Date.now() % 100000}`;
  await box.fill(`[mock-long:3000] ${tag}`);
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "중지", exact: true })).toBeVisible();
  // Wait for some of the reply, then leave.
  await page.waitForTimeout(1500);
  const conversation = ((await (await page.context().request.get(`${SITE}/api/chat/conversations`)).json()) as { id: number; title: string }[]).find((row) => row.title.includes(tag))!;

  await page.getByRole("link", { name: "Project Builder" }).first().click();
  await expect(page).toHaveURL(/\/builder/);
  await expect(page.getByTestId("nav-running").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1440-left-chat-dot.png` });

  // A fresh page knows nothing of its own — the dot comes from the server.
  await page.reload();
  await expect(page.getByTestId("nav-running").first()).toBeVisible({ timeout: 10_000 });
  const running = (await (await page.context().request.get(`${SITE}/api/chat/running`)).json()) as { conversations: number[] };
  expect(running.conversations).toContain(conversation.id);

  // Back to Chat: the row has its dot; opening it shows the reply so far and follows it.
  await page.getByRole("link", { name: "Chat" }).first().click();
  const row = page.getByTestId("row-running").first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/1440-chat-row-dot.png` });
  await row.click();
  await expect(page.getByRole("button", { name: "중지", exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1440-followed-reply.png` });
  await expect(page.getByRole("button", { name: "중지", exact: true })).toHaveCount(0, { timeout: 60_000 });

  const detail = (await (await page.context().request.get(`${SITE}/api/chat/conversations/${conversation.id}`)).json()) as Detail;
  expect(detail.running).toBeNull();
  const replies = detail.messages.filter((m) => m.role === "assistant");
  expect(replies).toHaveLength(1);
  expect(replies[0].status).toBe("complete");
  expect(replies[0].content.length).toBeGreaterThan(2000);
  await expect(page.getByTestId("row-running")).toHaveCount(0, { timeout: 10_000 });

  await page.context().request.delete(`${SITE}/api/chat/conversations/${conversation.id}`, { data: {} });
});

test("중지 from another tab stops the reply; the first tab shows it 중지됨", async ({ page, context }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/`);
  const box = page.getByLabel("CTRL+AI에게 보낼 메시지");
  const tag = `다른 탭 중지 e2e ${Date.now() % 100000}`;
  await box.fill(`[mock-long:3000] ${tag}`);
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "중지", exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  const conversation = ((await (await context.request.get(`${SITE}/api/chat/conversations`)).json()) as { id: number; title: string }[]).find((row) => row.title.includes(tag))!;

  const other = await context.newPage();
  await other.goto(`${SITE}/`);
  await other.getByTestId("row-running").first().click();
  await other.getByRole("button", { name: "중지", exact: true }).click();

  await expect(page.getByText(/중지됨/).first()).toBeVisible({ timeout: 20_000 });
  await expect(other.getByRole("button", { name: "중지", exact: true })).toHaveCount(0, { timeout: 20_000 });
  const detail = (await (await context.request.get(`${SITE}/api/chat/conversations/${conversation.id}`)).json()) as Detail;
  const replies = detail.messages.filter((m) => m.role === "assistant");
  expect(replies).toHaveLength(1);
  expect(replies[0].status).toBe("stopped");
  await page.screenshot({ path: `${SHOTS}/1440-stopped-from-other-tab.png` });
  await other.close();
  await context.request.delete(`${SITE}/api/chat/conversations/${conversation.id}`, { data: {} });
});
