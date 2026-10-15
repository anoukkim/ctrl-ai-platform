/**
 * app-platform P2 — signing in to an app and ctrlai.ai, in a real browser.
 *
 * Needs the whole local stack: the site (`SITE_ORIGIN`, next dev), the
 * backend with `APPS_BASE_URL` = the apps origin, the apps server
 * (`APPS_ORIGIN`), a published app, and a participating member with a
 * wallet to sign in as (`E2E_USER` / `E2E_PASSWORD`, the dev seed by
 * default). Mock Claude: the money is the mock's, in the dev database.
 */

import { expect, test, type Frame, type Page } from "@playwright/test";

const APPS = process.env.APPS_ORIGIN ?? "http://localhost:8300";
const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";

type Ctrlai = {
  user(): Promise<{ displayName: string; appUserId: string } | null>;
  login(): Promise<{ displayName: string; appUserId: string }>;
  logout(): Promise<void>;
  ai: {
    ask(options: unknown): Promise<{ text: string; json: unknown; chargedKrw: number; model: string }>;
    stream(options: unknown, onChunk: (text: string) => void): Promise<{ text: string; chargedKrw: number }>;
  };
};
declare global {
  interface Window {
    ctrlai: Ctrlai;
    __chunks: string[];
  }
}

async function appFrame(page: Page, slug: string): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(() => (frame = page.frames().find((f) => f.url().includes(`/${slug}/_app/`))) !== undefined)
    .toBe(true);
  await frame!.waitForFunction(() => typeof window.ctrlai === "object");
  return frame!;
}

test("sign in through the consent window, then AI paid by the visitor", async ({ page, context }) => {
  // The site's dev server may compile the consent page on first use.
  test.setTimeout(120_000);
  // Signed in on the site — which by itself does not sign anyone in to an app.
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { slug: string; name: string }[];
  expect(apps.length).toBeGreaterThan(0);
  const slug = apps[0].slug;

  await page.goto(`${APPS}/${slug}/`);
  const frame = await appFrame(page, slug);
  expect(await frame.evaluate(() => window.ctrlai.user())).toBeNull();

  // An AI call while signed out starts the sign-in: the consent window.
  const consentPromise = context.waitForEvent("page");
  const asked = frame.evaluate(() =>
    window.ctrlai.ai.ask({ prompt: "안녕? 한 줄로 답해 줘." }).then(
      (answer) => ({ ok: true as const, answer }),
      (error: Error & { code?: string }) => ({ ok: false as const, message: error.message, code: error.code }),
    ),
  );
  const consent = await consentPromise;
  await consent.waitForLoadState();
  expect(consent.url()).toContain("/apps/connect?app=");
  await expect(consent.getByRole("heading", { name: /연결할까요/ })).toBeVisible({ timeout: 45_000 });
  await expect(consent.getByText(/최대 200원/)).toBeVisible();
  await consent.getByRole("button", { name: "허용" }).click();
  await consent.waitForEvent("close", { timeout: 15_000 });

  const result = await asked;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) {
    expect(result.answer.text.length).toBeGreaterThan(0);
    expect(result.answer.chargedKrw).toBeGreaterThan(0);
  }
  await expect(page.locator("#ctrlai-note")).toContainText("앱 AI ·");

  const user = await frame.evaluate(() => window.ctrlai.user());
  expect(user?.appUserId).toMatch(/^u_/);
  expect(Object.keys(user ?? {}).sort()).toEqual(["appUserId", "displayName"]);

  // Streaming arrives in pieces, then the charge.
  const streamed = await frame.evaluate(() => {
    window.__chunks = [];
    return window.ctrlai.ai.stream({ prompt: "조금 길게 답해 줘" }, (text) => window.__chunks.push(text));
  });
  expect(await frame.evaluate(() => window.__chunks.length)).toBeGreaterThan(1);
  expect(streamed.chargedKrw).toBeGreaterThan(0);

  // JSON with a schema comes back parsed.
  const parsed = await frame.evaluate(() =>
    window.ctrlai.ai.ask({
      prompt: "영수증을 읽어 줘",
      json: { type: "object", required: ["shop"], properties: { shop: { type: "string" } } },
    }),
  );
  expect(parsed.json).toEqual({ shop: "예시" });

  // Disconnect from the site: the app sees a signed-out visitor again.
  const consents = (await (await context.request.get(`${SITE}/api/me/app-consents`)).json()) as { id: number; app_name: string }[];
  const mine = consents.find((row) => row.app_name === apps[0].name);
  expect(mine).toBeTruthy();
  const revoked = await context.request.post(`${SITE}/api/me/app-consents/${mine!.id}/revoke`, { data: {} });
  expect(revoked.ok()).toBeTruthy();
  expect(await frame.evaluate(() => window.ctrlai.user())).toBeNull();
});
