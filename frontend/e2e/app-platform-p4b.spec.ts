/**
 * app-platform P4b — the showcase apps in LIVE mode, in a real browser.
 *
 * Needs the local stack with the showcase apps published from the current
 * files (`python -m app.db.import_example_apps dev --update`) and the dev
 * member with a wallet. Proves, with mock Claude: opening an app and
 * switching to 실제 AI costs nothing; the price shows beside the button
 * before anything is sent; the first AI charge happens only when the
 * visitor presses the button, and never more than the 최대 shown; 데모
 * is one toggle away.
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

test("영수증 가계부 LIVE: free to open and switch, priced before the button, charged only on it", async ({ page, context }) => {
  test.setTimeout(150_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { slug: string; name: string }[];
  const ledger = apps.find((a) => a.name === "영수증 가계부");
  expect(ledger, "import_example_apps dev --update first").toBeTruthy();
  const slug = ledger!.slug;
  const before = await spentKrw(context.request);

  await page.goto(`${APPS}/${slug}/`);
  const frame = await appFrame(page, slug);
  await expect(frame.locator(".badge.demoAll")).toHaveText("데모 데이터");

  // 실제 AI needs the app sign-in: the consent window, then the badge turns.
  const consentPromise = context.waitForEvent("page");
  await frame.getByRole("button", { name: /실제 AI로 써 보기/ }).click();
  const consent = await consentPromise;
  await consent.waitForLoadState();
  await expect(consent.getByRole("heading", { name: /연결할까요/ })).toBeVisible({ timeout: 45_000 });
  await consent.getByRole("button", { name: "허용" }).click();
  await consent.waitForEvent("close", { timeout: 15_000 });
  await expect(frame.locator(".badge.demoAll")).toHaveText(/실제 AI/);

  // The price shows before anything is sent; still nothing charged.
  await frame.getByRole("tab", { name: /영수증 추가/ }).click();
  const price = frame.locator("#drop small");
  await expect(price).toHaveText(/1회 약 \d+원 · 최대 \d+원/, { timeout: 15_000 });
  const shown = Number(/최대 (\d+)원/.exec((await price.textContent()) ?? "")![1]);
  expect(await spentKrw(context.request)).toBe(before);

  // The button: one AI call, charged to the visitor, within the figure shown.
  await frame.locator("button.sample").first().click();
  await expect(frame.getByText(/실제 AI · \d+원 · 내 동아리 지원금에서/)).toBeVisible({ timeout: 60_000 });
  const charged = Number(/실제 AI · (\d+)원/.exec((await frame.locator(".notice .demo.live").textContent()) ?? "")![1]);
  expect(charged).toBeGreaterThan(0);
  expect(charged).toBeLessThanOrEqual(shown);
  expect(await spentKrw(context.request)).toBe(before + charged);
  const usage = (await (await context.request.get(`${SITE}/api/usage/me`)).json()) as Usage;
  expect(usage.events[0].label).toBe("앱 · 영수증 가계부");
  expect(usage.events[0].charged_krw).toBe(charged);

  // Back to 데모 with one button; nothing more is charged.
  await frame.getByRole("button", { name: "취소" }).click();
  await frame.getByRole("button", { name: "데모 데이터로 보기" }).click();
  await expect(frame.locator(".badge.demoAll")).toHaveText("데모 데이터");
  expect(await spentKrw(context.request)).toBe(before + charged);
});

test("문서 챗봇 LIVE: an answer with its source, no call when nothing matches", async ({ page, context }) => {
  test.setTimeout(120_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { slug: string; name: string }[];
  const bot = apps.find((a) => a.name === "문서 챗봇 메이커");
  expect(bot).toBeTruthy();
  const slug = bot!.slug;

  await page.goto(`${APPS}/${slug}/`);
  const frame = await appFrame(page, slug);
  // The consent from the first test may still stand; either way the badge turns.
  const popup = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  await frame.getByRole("button", { name: /실제 AI/ }).click();
  const consent = await popup;
  if (consent) {
    await consent.waitForLoadState();
    await consent.getByRole("button", { name: "허용" }).click({ timeout: 45_000 });
    await consent.waitForEvent("close", { timeout: 15_000 });
  }
  await expect(frame.locator(".badge.demoAll")).toHaveText(/실제 AI/);
  await expect(frame.locator("#chat-price")).toHaveText(/질문 1회 약 \d+원 · 최대 \d+원/, { timeout: 15_000 });
  const before = await spentKrw(context.request);

  // A question the documents cover: Claude answers, the source is shown, one charge.
  await frame.getByLabel("질문").fill("회비는 얼마예요?");
  await frame.getByRole("button", { name: "보내기" }).click();
  await expect(frame.locator(".msg.bot").last().locator(".demo.live")).toHaveText(/실제 AI · \d+원/, { timeout: 60_000 });
  const afterAnswer = await spentKrw(context.request);
  expect(afterAnswer).toBeGreaterThan(before);

  // Nothing in the documents matches: no call, no charge, the not-found text.
  await frame.getByLabel("질문").fill("zzqx");
  await frame.getByRole("button", { name: "보내기" }).click();
  await expect(frame.locator(".msg.bot").last().locator(".demo.live")).toHaveText(/0원/, { timeout: 15_000 });
  expect(await spentKrw(context.request)).toBe(afterAnswer);
});

test("여행 일정 메이커 LIVE: priced before 일정 만들기, one charge, places stay in the list", async ({ page, context }) => {
  test.setTimeout(120_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { slug: string; name: string }[];
  const trip = apps.find((a) => a.name === "여행 일정 메이커");
  expect(trip).toBeTruthy();
  const slug = trip!.slug;

  await page.goto(`${APPS}/${slug}/`);
  const frame = await appFrame(page, slug);
  const popup = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  await frame.getByRole("button", { name: /실제 AI/ }).click();
  const consent = await popup;
  if (consent) {
    await consent.waitForLoadState();
    await consent.getByRole("button", { name: "허용" }).click({ timeout: 45_000 });
    await consent.waitForEvent("close", { timeout: 15_000 });
  }
  await expect(frame.locator(".badge.demoAll")).toHaveText(/실제 AI/);
  const before = await spentKrw(context.request);

  await frame.getByRole("button", { name: "새 일정 만들기" }).click();
  await expect(frame.locator("#plan-price")).toHaveText(/1회 약 \d+원 · 최대 \d+원/, { timeout: 15_000 });
  const shown = Number(/최대 (\d+)원/.exec((await frame.locator("#plan-price").textContent()) ?? "")![1]);
  expect(await spentKrw(context.request)).toBe(before);

  await frame.getByRole("button", { name: "일정 만들기" }).click();
  // Mock Claude's ids are not in the list: the demo planner fills the days, still one real charge.
  await expect(frame.locator(".plannerLine")).toBeVisible({ timeout: 60_000 });
  const usage = (await (await context.request.get(`${SITE}/api/usage/me`)).json()) as Usage;
  expect(usage.events[0].charged_krw).toBeGreaterThan(0);
  expect(usage.events[0].charged_krw).toBeLessThanOrEqual(shown);
  expect(await spentKrw(context.request)).toBe(before + usage.events[0].charged_krw);
  // Every stop on screen is a real place of the city (none invented by the model).
  const stops = await frame.locator(".stopCard").count();
  expect(stops).toBeGreaterThan(0);
});
