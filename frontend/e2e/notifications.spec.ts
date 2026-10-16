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

test("게시 writes a notification: the bell counts it, opening clears the count, a row leads to the app, Profile keeps only the switches", async ({ page, context }) => {
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
  // owner-polish-3 (c2): opening is reading — the number is gone at once, and 지우기 is there instead of 모두 읽음.
  await expect(page.getByTestId("notification-count")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "지우기" })).toBeVisible();
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-bell-panel.png` });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-bell-panel.png` });

  // The row leads to the app detail (it was read when the panel opened).
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/ctrlaistore/${slug}$`));
  await expect(dialog).toBeHidden();
  const listed = (await (await context.request.get(`${SITE}/api/notifications`)).json()) as { items: { title: string; read_at: string | null }[] };
  expect(listed.items.find((n) => n.title.includes(name))?.read_at).not.toBeNull();

  // Profile: only the two switches — the list lives in the bell (owner-polish-3 (c2)).
  await page.goto(`${SITE}/profile`);
  await expect(page.getByTestId("notification-feed")).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(2);
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-profile-notifications.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("switch")).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/390-light-profile-notifications.png` });

  // The phone's top bar holds the bell — no need to open 메뉴.
  await expect(page.getByRole("banner").getByRole("button", { name: /^알림/ })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: /^알림/ }).click();
  const phoneDialog = page.getByRole("dialog", { name: "알림" });
  await expect(phoneDialog).toBeVisible();
  await expect(phoneDialog.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/390-light-bell-panel.png` });

  // Tidy.
  expect((await context.request.delete(`${SITE}/api/builder/projects/${project.id}`)).ok()).toBeTruthy();
});
