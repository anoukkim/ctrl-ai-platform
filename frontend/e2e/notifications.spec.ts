/**
 * feat-notifications (owner-polish 2) — in a real browser.
 *
 * Needs the local stack and the dev member taking part. Proves: 게시 writes
 * a notification the bell counts; the panel lists it; a row marks itself
 * read and leads to the app; 모두 읽음 clears the count; Profile › 알림
 * shows the same list above the switches. Screenshots land in
 * docs/progress/screens/notifications/.
 *
 *   SITE_ORIGIN=http://localhost:3400 npx playwright test e2e/notifications.spec.ts --workers=1
 */

import { expect, test, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";
const SHOTS = "../docs/progress/screens/notifications";

test.use({ actionTimeout: 20_000 });

const HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>e2e</title></head><body><main><h1>알림 e2e</h1></main></body></html>`;

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
  await page.waitForTimeout(600);
}

test("게시 writes a notification: the bell counts it, the panel lists it, a row reads itself and leads to the app, Profile shows the list", async ({ page, context }) => {
  test.setTimeout(120_000);
  await login(page);
  // Start clean: everything read.
  await context.request.post(`${SITE}/api/notifications/read-all`, { data: {} });
  const name = `알림 e2e ${Date.now() % 100000}`;
  const made = await context.request.post(`${SITE}/api/builder/projects/from-chat`, { data: { name, description: "", html: HTML } });
  expect(made.status()).toBe(201);
  const project = (await made.json()) as { id: number };
  const published = await context.request.post(`${SITE}/api/builder/projects/${project.id}/publish`, {
    data: { description: "알림을 확인하는 e2e 앱이에요.", note: "" },
  });
  expect(published.ok()).toBeTruthy();
  const slug = ((await published.json()) as { app_slug: string }).app_slug;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/`);
  const bell = page.getByRole("button", { name: /^알림 — 안 읽음 \d+개$/ });
  await expect(bell).toBeVisible();
  await expect(page.getByTestId("notification-count")).toHaveText(/^[1-9]\d*$/);
  await bell.click();
  const dialog = page.getByRole("dialog", { name: "알림" });
  await expect(dialog).toBeVisible();
  const row = dialog.getByRole("button", { name: new RegExp(`안 읽음 · .*'${name}' 게시 완료 — v1`) });
  await expect(row).toBeVisible();
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-bell-panel.png` });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-bell-panel.png` });

  // The row: read, and the app detail opens.
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/ctrlaistore/${slug}$`));
  await expect(dialog).toBeHidden();
  const listed = (await (await context.request.get(`${SITE}/api/notifications`)).json()) as { items: { title: string; read_at: string | null }[] };
  expect(listed.items.find((n) => n.title.includes(name))?.read_at).not.toBeNull();

  // Profile: the same list above the two switches; 모두 읽음 clears the bell.
  await context.request.post(`${SITE}/api/notifications/read-all`, { data: {} });
  await page.goto(`${SITE}/profile`);
  const feed = page.getByTestId("notification-feed");
  await expect(feed).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(2);
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-profile-notifications.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("notification-feed")).toBeVisible();
  await page.getByTestId("notification-feed").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/390-light-profile-notifications.png` });

  // The phone's menu holds the bell too.
  await page.getByRole("button", { name: "메뉴" }).click();
  await expect(page.getByRole("button", { name: /^알림/ })).toBeVisible();
  await page.getByRole("button", { name: /^알림/ }).click();
  const phoneDialog = page.getByRole("dialog", { name: "알림" });
  await expect(phoneDialog).toBeVisible();
  await expect(phoneDialog.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/390-light-bell-panel.png` });

  // Tidy.
  expect((await context.request.delete(`${SITE}/api/builder/projects/${project.id}`)).ok()).toBeTruthy();
});
