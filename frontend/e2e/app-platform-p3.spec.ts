/**
 * app-platform P3 — ctrlai.db in a real browser.
 *
 * Needs the same local stack as the P2 spec (site, backend with
 * `APPS_BASE_URL`, apps server, a published app, the dev member). The
 * first save while signed out opens the consent window; 허용 lets the
 * save through. Then shared data is readable signed out, and the author
 * changes and removes their item. Writes to the dev database.
 */

import { expect, test, type Frame, type Page } from "@playwright/test";

const APPS = process.env.APPS_ORIGIN ?? "http://localhost:8300";
const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";

async function appFrame(page: Page, slug: string): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(() => (frame = page.frames().find((f) => f.url().includes(`/${slug}/_app/`))) !== undefined)
    .toBe(true);
  await frame!.waitForFunction(() => typeof window.ctrlai === "object");
  return frame!;
}

test("a shared item: saved after the consent window, read signed out, changed and removed by its author", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as { slug: string }[];
  expect(apps.length).toBeGreaterThan(0);
  const slug = apps[0].slug;
  const collection = `e2e_${Date.now().toString(36)}`;

  await page.goto(`${APPS}/${slug}/`);
  const frame = await appFrame(page, slug);
  expect(await frame.evaluate(() => window.ctrlai.version)).toBe("6");

  // Signed out: a shared collection that does not exist yet is empty, the
  // private list of the same name is refused, and a write starts the sign-in.
  expect(await frame.evaluate((name) => window.ctrlai.db.list(name, { shared: true }), collection)).toEqual({
    items: [],
    nextCursor: null,
  });
  const refusedRead = await frame.evaluate((name) =>
    window.ctrlai.db.list(name).then(
      () => "listed",
      (error: Error & { code?: string }) => error.code,
    ), collection);
  expect(refusedRead).toBe("login_required");
  const consentPromise = context.waitForEvent("page");
  const saving = frame.evaluate(
    (name) =>
      window.ctrlai.db.save(name, { text: "첫 글", likes: 0 }, { shared: true }).then(
        (item) => ({ ok: true as const, item }),
        (error: Error & { code?: string }) => ({ ok: false as const, message: error.message, code: error.code }),
      ),
    collection,
  );
  const consent = await consentPromise;
  await consent.waitForLoadState();
  await expect(consent.getByRole("heading", { name: /연결할까요/ })).toBeVisible({ timeout: 45_000 });
  await expect(consent.getByText(/데이터를 저장해요/)).toBeVisible();
  await consent.getByRole("button", { name: "허용" }).click();
  await consent.waitForEvent("close", { timeout: 15_000 });

  const saved = await saving;
  expect(saved.ok, JSON.stringify(saved)).toBe(true);
  if (!saved.ok) return;
  expect(saved.item.id).toMatch(/^d_/);
  expect(saved.item.mine).toBe(true);
  expect(saved.item.author.appUserId).toMatch(/^u_/);

  // Change and count as the author.
  const changed = await frame.evaluate(
    ([name, id]) => window.ctrlai.db.update(name, id, { likes: 1 }, { shared: true }),
    [collection, saved.item.id] as const,
  );
  expect(changed.data).toEqual({ text: "첫 글", likes: 1 });
  expect(await frame.evaluate((name) => window.ctrlai.db.count(name, { shared: true, where: { likes: 1 } }), collection)).toBe(1);
  // The private list of that name is a different, empty list — even for the author.
  expect(await frame.evaluate((name) => window.ctrlai.db.count(name), collection)).toBe(0);

  // A fresh browser, signed out: reads the shared item, cannot change it.
  const strangerContext = await page.context().browser()!.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto(`${APPS}/${slug}/`);
  const strangerFrame = await appFrame(stranger, slug);
  const seen = await strangerFrame.evaluate((name) => window.ctrlai.db.list(name, { shared: true }), collection);
  expect(seen.items.map((item) => item.data)).toEqual([{ text: "첫 글", likes: 1 }]);
  expect(seen.items[0].mine).toBe(false);
  expect(seen.items[0].canDelete).toBe(false);
  // A write starts a sign-in (the consent window); closing it without
  // signing in rejects the write — nothing was removed.
  const popupPromise = strangerContext.waitForEvent("page");
  const refusedPromise = strangerFrame.evaluate(
    ([name, id]) =>
      window.ctrlai.db.remove(name, id, { shared: true }).then(
        () => "removed",
        (error: Error & { code?: string }) => error.code,
      ),
    [collection, saved.item.id] as const,
  );
  const popup = await popupPromise;
  await popup.close();
  expect(await refusedPromise).toBe("login_required");
  expect(await strangerFrame.evaluate((name) => window.ctrlai.db.count(name, { shared: true }), collection)).toBe(1);
  await strangerContext.close();

  // The author removes it; the list is empty again.
  await frame.evaluate(([name, id]) => window.ctrlai.db.remove(name, id, { shared: true }), [collection, saved.item.id] as const);
  expect(await frame.evaluate((name) => window.ctrlai.db.count(name, { shared: true }), collection)).toBe(0);
});
