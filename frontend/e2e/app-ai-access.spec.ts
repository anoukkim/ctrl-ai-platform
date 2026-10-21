/**
 * app-ai-access — in a real browser: the maker's 데모만 / 전체 기능 and the
 * visitor's switch in the shell.
 *
 * The dev user owns the showcases (import_example_apps) and is also the
 * visitor here. The app's setting is flipped through the owner's route and
 * put back to 전체 기능 at the end, whatever happens — the other specs rely
 * on the showcases being live.
 */
import { expect, test, type Frame, type Page } from "@playwright/test";

const APPS = process.env.APPS_ORIGIN ?? "http://localhost:8300";
const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";

declare global {
  interface Window {
    __modes: string[];
  }
}

async function appFrame(page: Page, slug: string): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(() => (frame = page.frames().find((f) => f.url().includes(`/${slug}/_app/`))) !== undefined, { timeout: 30_000 })
    .toBe(true);
  await frame!.waitForFunction(() => typeof window.ctrlai === "object");
  return frame!;
}

function askOutcome(frame: Frame) {
  return frame.evaluate(() =>
    window.ctrlai.ai.ask({ prompt: "안녕? 한 줄로." }).then(
      (answer) => ({ ok: true as const, charged: answer.chargedKrw }),
      (error: Error & { code?: string }) => ({ ok: false as const, code: error.code, message: error.message }),
    ),
  );
}

test("데모만 refuses with code demo and 0원; 전체 기능 shows the visitor's switch, which also costs nothing", async ({ page, context }) => {
  test.setTimeout(150_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { id: number; slug: string; uses_ai: boolean; ai_access: string }[];
  const app = apps.find((a) => a.uses_ai);
  expect(app, "a published app that uses AI (a showcase)").toBeTruthy();
  const { id, slug } = app!;
  const before = (await (await context.request.get(`${SITE}/api/usage/me`)).json()).events.length as number;

  const setAccess = async (value: "demo" | "full") => {
    const r = await context.request.post(`${SITE}/api/builder/projects/${id}/ai-access`, { data: { ai_access: value } });
    expect(r.ok(), await r.text()).toBeTruthy();
  };

  try {
    // 1. 데모만: the bar says so, there is no switch, and a call fails with code "demo" — no sign-in window.
    await setAccess("demo");
    expect((await (await context.request.get(`${SITE}/api/apps/${slug}`)).json()).ai_access).toBe("demo");
    await page.goto(`${APPS}/${slug}/`);
    let frame = await appFrame(page, slug);
    await expect(page.locator("#ctrlai-ai")).toContainText("데모 전용");
    await expect(page.getByRole("switch", { name: "실제 AI" })).toHaveCount(0);
    expect(await frame.evaluate(() => window.ctrlai.ai.mode())).toBe("demo");
    let outcome = await askOutcome(frame);
    expect(outcome).toMatchObject({ ok: false, code: "demo" });
    expect(context.pages().length).toBe(1);

    // 2. 전체 기능: a switch, on by default; the visitor's choice is kept across a reload.
    await setAccess("full");
    await page.reload();
    frame = await appFrame(page, slug);
    // Signed out of the app: the bar says the wallet pays only after sign-in.
    await expect(page.locator("#ctrlai-ai")).toContainText("실제 AI 켜짐");
    await expect(page.locator("#ctrlai-ai")).toContainText("로그인하고, 내 지원금에서");
    await expect(page.locator("#ctrlai-ai")).toHaveAttribute("data-state", "on");
    await expect(page.getByRole("switch", { name: "실제 AI" })).toHaveAttribute("aria-checked", "true");
    expect(await frame.evaluate(() => window.ctrlai.ai.mode())).toBe("live");
    await frame.evaluate(() => {
      window.__modes = [];
      window.addEventListener("ctrlai:ai-mode", (event) => window.__modes.push((event as CustomEvent).detail.mode));
    });
    await page.getByRole("switch", { name: "실제 AI" }).click();
    await expect(page.locator("#ctrlai-ai")).toContainText("데모 · AI 꺼짐");
    await expect(page.locator("#ctrlai-ai")).toHaveAttribute("data-state", "off");
    expect(await frame.evaluate(() => window.__modes)).toEqual(["demo"]);
    expect(await frame.evaluate(() => window.ctrlai.ai.mode())).toBe("demo");
    outcome = await askOutcome(frame);
    expect(outcome).toMatchObject({ ok: false, code: "demo" });

    await page.reload();
    frame = await appFrame(page, slug);
    await expect(page.getByRole("switch", { name: "실제 AI" })).toHaveAttribute("aria-checked", "false");
    await page.getByRole("switch", { name: "실제 AI" }).click();
    await expect(page.locator("#ctrlai-ai")).toContainText("실제 AI 켜짐");

    // 3. Live again, signed out of the app: a call starts the sign-in window
    // (the old path) — the local gate never mistakes "not signed in" for 데모.
    await frame.evaluate(() => window.ctrlai.logout().catch(() => undefined));
    const consentPromise = context.waitForEvent("page");
    const pendingAsk = askOutcome(frame);
    const consent = await consentPromise;
    await consent.waitForLoadState();
    expect(consent.url()).toContain("/apps/connect?app=");
    await consent.close();
    const cancelled = await pendingAsk;
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.code).not.toBe("demo");

    // Nothing was charged by any of this: the ledger did not grow.
    const after = (await (await context.request.get(`${SITE}/api/usage/me`)).json()).events.length as number;
    expect(after).toBe(before);
  } finally {
    await setAccess("full");
  }
});
