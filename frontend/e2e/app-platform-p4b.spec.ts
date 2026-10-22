/**
 * app-platform P4b — the showcase apps in LIVE mode, in a real browser.
 *
 * Needs the local stack with the showcase apps published from the current
 * files (`python -m app.db.import_example_apps dev --update`) and the dev
 * member with a wallet. Proves, with mock Claude: opening an app and
 * switching to 실제 AI costs nothing; the price shows beside the button
 * before anything is sent; the first AI charge happens only when the
 * visitor presses the button, and never more than the 최대 shown; 데모
 * is one toggle away. Since fix-single-ai-switch (2026-10-21) that toggle
 * is CTRL+AI's bar above the app — the apps have none of their own, and
 * sign-in comes with the first AI call.
 */

import { expect, test, type Frame, type Page } from "@playwright/test";

const APPS = process.env.APPS_ORIGIN ?? "http://localhost:8300";
const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";

test.use({ actionTimeout: 20_000 });

async function appFrame(page: Page, slug: string): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(() => (frame = page.frames().find((f) => f.url().includes(`/${slug}/_app/`))) !== undefined, { timeout: 30_000 })
    .toBe(true);
  await frame!.waitForFunction(() => typeof window.ctrlai === "object");
  return frame!;
}

type Usage = { events: { label: string; charged_krw: number }[]; wallet: { consumed_krw: number } | null };

/** What the wallet has spent — `events` is only the recent page, so a count would stop moving. */
async function spentKrw(request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> }): Promise<number> {
  const usage = (await (await request.get(`${SITE}/api/usage/me`)).json()) as Usage;
  return usage.wallet?.consumed_krw ?? 0;
}

test("출장·여행 준비 도우미 LIVE: free to open and switch, priced before the button, charged only on it", async ({ page, context }) => {
  test.setTimeout(150_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { slug: string; name: string }[];
  const prep = apps.find((a) => a.name === "출장·여행 준비 도우미");
  expect(prep, "import_example_apps dev --replace first").toBeTruthy();
  const slug = prep!.slug;
  const before = await spentKrw(context.request);

  await page.goto(`${APPS}/${slug}/`);
  const frame = await appFrame(page, slug);
  // One switch: the bar says 실제 AI, the app repeats nothing and has no toggle.
  await expect(page.locator("#ctrlai-ai")).toHaveAttribute("data-state", "on");
  await expect(frame.locator(".badge.demoAll")).toBeHidden();
  await expect(frame.locator("#mode-toggle")).toHaveCount(0);

  // The price shows before anything is sent; the free fields work without AI.
  await expect(frame.locator("#read-price")).toHaveText(/1회 약 \d+원/, { timeout: 15_000 });
  await frame.locator("#dest").selectOption("오사카");
  await expect(frame.locator(".ticket")).toContainText("OSA");
  expect(await spentKrw(context.request)).toBe(before);

  // Its own AI button: one call (sign-in first, the consent window), charged to the visitor.
  const consentPromise = context.waitForEvent("page");
  await frame.locator("#read-ai").click();
  const consent = await consentPromise;
  await consent.waitForLoadState();
  await expect(consent.getByRole("heading", { name: /연결할까요/ })).toBeVisible({ timeout: 45_000 });
  await consent.getByRole("button", { name: "허용" }).click();
  await consent.waitForEvent("close", { timeout: 15_000 });
  await expect(frame.locator("#note")).toContainText(/실제 AI · \d+원/, { timeout: 60_000 });
  const charged = Number(/실제 AI · (\d+)원/.exec((await frame.locator("#note").textContent()) ?? "")![1]);
  expect(charged).toBeGreaterThan(0);
  expect(await spentKrw(context.request)).toBe(before + charged);
  const usage = (await (await context.request.get(`${SITE}/api/usage/me`)).json()) as Usage;
  expect(usage.events[0].label).toBe("앱 · 출장·여행 준비 도우미");

  // Back to 데모 with the bar's switch — the app follows; nothing more is charged.
  await page.getByRole("switch", { name: "실제 AI" }).click();
  await expect(page.locator("#ctrlai-ai")).toHaveAttribute("data-state", "off");
  await expect(frame.locator("#read-ai")).toHaveCount(0);
  expect(await spentKrw(context.request)).toBe(before + charged);
});

test("문서 챗봇 LIVE: the quote is free, AI로 정리 answers with its source, no AI button when nothing matches", async ({ page, context }) => {
  test.setTimeout(120_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { slug: string; name: string }[];
  const bot = apps.find((a) => a.name === "문서 챗봇 메이커");
  expect(bot).toBeTruthy();
  const slug = bot!.slug;

  await page.goto(`${APPS}/${slug}/`);
  const frame = await appFrame(page, slug);
  await expect(page.locator("#ctrlai-ai")).toHaveAttribute("data-state", "on");
  await expect(frame.locator("#chat-price")).toHaveText(/질문 1회 약 \d+원 · 최대 \d+원/, { timeout: 15_000 });
  const before = await spentKrw(context.request);

  // A question the documents cover: the free answer first (the quote, 0원) …
  await frame.getByLabel("질문").fill("회비는 얼마예요?");
  await frame.getByRole("button", { name: "보내기" }).click();
  const aiButton = frame.locator(".msg.bot").last().locator("[data-ai]");
  await expect(aiButton).toBeVisible({ timeout: 15_000 });
  expect(await spentKrw(context.request)).toBe(before);
  // … then Claude only on its own button: the source is shown, one charge.
  // The consent from the first test may still stand; if not, it comes with this first call.
  const popup = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  await aiButton.click();
  const consent = await popup;
  if (consent) {
    await consent.waitForLoadState();
    await consent.getByRole("button", { name: "허용" }).click({ timeout: 45_000 });
    await consent.waitForEvent("close", { timeout: 15_000 });
  }
  await expect(frame.locator(".msg.bot").last().locator(".demo.live")).toHaveText(/실제 AI · \d+원/, { timeout: 60_000 });
  const afterAnswer = await spentKrw(context.request);
  expect(afterAnswer).toBeGreaterThan(before);

  // Nothing in the documents matches: the not-found text, and no AI button to press.
  await frame.getByLabel("질문").fill("zzqx");
  await frame.getByRole("button", { name: "보내기" }).click();
  await expect(frame.locator(".msg.bot").last().locator(".after")).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator(".msg.bot").last().locator("[data-ai]")).toHaveCount(0);
  expect(await spentKrw(context.request)).toBe(afterAnswer);
});

test("여행 일정 메이커 LIVE: 일정 만들기 is free, AI로 일정 짜기 priced and charged once, places stay in the list", async ({ page, context }) => {
  test.setTimeout(120_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { slug: string; name: string }[];
  const trip = apps.find((a) => a.name === "여행 일정 메이커");
  expect(trip).toBeTruthy();
  const slug = trip!.slug;

  await page.goto(`${APPS}/${slug}/`);
  const frame = await appFrame(page, slug);
  await expect(page.locator("#ctrlai-ai")).toHaveAttribute("data-state", "on");
  const before = await spentKrw(context.request);

  await frame.getByRole("button", { name: "새 일정 만들기" }).click();
  await expect(frame.locator("#plan-price")).toHaveText(/1회 약 \d+원 · 최대 \d+원/, { timeout: 15_000 });
  const shown = Number(/최대 (\d+)원/.exec((await frame.locator("#plan-price").textContent()) ?? "")![1]);
  expect(await spentKrw(context.request)).toBe(before);

  // Free first: 일정 만들기 plans by the rules — 0원, no sign-in.
  await frame.locator("#plan-submit").click();
  await expect(frame.locator(".plannerLine")).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator(".plannerLine .demo.live")).toHaveCount(0);
  expect(await spentKrw(context.request)).toBe(before);

  // AI only on its own button.
  await frame.getByRole("button", { name: "새 일정 만들기" }).click();
  const popup = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  await frame.locator("#plan-ai").click();
  const consent = await popup;
  if (consent) {
    await consent.waitForLoadState();
    await consent.getByRole("button", { name: "허용" }).click({ timeout: 45_000 });
    await consent.waitForEvent("close", { timeout: 15_000 });
  }
  // Mock Claude's ids are not in the list: the demo planner fills the days, still one real charge.
  await expect(frame.locator(".plannerLine .demo.live")).toBeVisible({ timeout: 60_000 });
  const usage = (await (await context.request.get(`${SITE}/api/usage/me`)).json()) as Usage;
  expect(usage.events[0].charged_krw).toBeGreaterThan(0);
  expect(usage.events[0].charged_krw).toBeLessThanOrEqual(shown);
  expect(await spentKrw(context.request)).toBe(before + usage.events[0].charged_krw);
  // Every stop on screen is a real place of the city (none invented by the model).
  const stops = await frame.locator(".stopCard").count();
  expect(stops).toBeGreaterThan(0);
});
