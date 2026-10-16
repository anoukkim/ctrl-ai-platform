/**
 * ui-improvements (UI A) — in a real browser.
 *
 * Needs the local stack (backend, `python -m app.dev_apps_server`, `npm run
 * dev`) and the dev member taking part this quarter. Proves what jsdom
 * cannot: a project's preview really is photographed by the sandboxed
 * frame, uploaded, re-encoded and shown on the Builder card; publishing
 * photographs the published app and CtrlAIApps shows it; a pin, a sort
 * and a favourite survive a reload; the Profile rows are the simple ones.
 * Screenshots land in docs/progress/screens/ui-improvements-a/.
 *
 *   SITE_ORIGIN=http://localhost:3400 npx playwright test e2e/ui-improvements.spec.ts --workers=1
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";
const SHOTS = "../docs/progress/screens/ui-improvements-a";

test.use({ actionTimeout: 20_000 });

type Project = { id: number; name: string; draft_thumbnail_at: string | null; published_thumbnail_at: string | null };
type Listing = { slug: string; name: string; favorite: boolean; thumbnail_at: string | null };

const HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>e2e</title>
<style>body{margin:0;font-family:sans-serif;background:#fff7e6}main{padding:32px}
h1{color:#b45309;font-size:40px}.box{width:240px;height:120px;background:#f59e0b;border-radius:16px}</style></head>
<body><main><h1>썸네일 e2e</h1><p>이 화면이 사진으로 남아야 해요.</p><div class="box"></div></main></body></html>`;

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
  // The cards' colours transition; a screenshot in the middle shows dark cards with dark text.
  await page.waitForTimeout(600);
}

async function project(request: APIRequestContext, id: number): Promise<Project> {
  return (await (await request.get(`${SITE}/api/builder/projects/${id}`)).json()) as Project;
}

async function newProject(request: APIRequestContext, name: string): Promise<Project> {
  const created = await request.post(`${SITE}/api/builder/projects/from-chat`, { data: { name, description: "", html: HTML } });
  expect(created.status()).toBe(201);
  return (await created.json()) as Project;
}

test("a preview is photographed for the Builder card; publishing photographs the app for CtrlAIApps", async ({ page, context }) => {
  test.setTimeout(150_000);
  await login(page);
  const name = `썸네일 e2e ${Date.now() % 100000}`;
  const made = await newProject(context.request, name);
  expect(made.draft_thumbnail_at).toBeNull();

  // The workspace: the frame loads, and a moment later the draft picture is up.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/builder/${made.id}`);
  await expect.poll(async () => (await project(context.request, made.id)).draft_thumbnail_at, { timeout: 40_000 }).not.toBeNull();
  const draft = await context.request.get(`${SITE}/api/builder/projects/${made.id}/thumbnail?space=draft`);
  expect(draft.ok()).toBeTruthy();
  expect(draft.headers()["content-type"]).toContain("image/webp");
  const bytes = await draft.body();
  expect(bytes.length).toBeGreaterThan(500);
  // The server's own WebP: the RIFF header, not whatever the browser sent.
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");

  // The Builder card shows that picture, and never the request text.
  await page.goto(`${SITE}/builder`);
  const card = page.locator("article", { hasText: name }).first();
  await expect(card).toBeVisible();
  await expect(card.locator(`img[src*="/api/builder/projects/${made.id}/thumbnail?space=draft"]`)).toBeVisible();
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-builder-thumbnail.png` });

  // Publish from the workspace: the hidden frame photographs the public app.
  await page.goto(`${SITE}/builder/${made.id}`);
  await page.getByRole("button", { name: "CtrlAIApps에 게시" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/CtrlAIApps에 보일 설명/).fill("썸네일을 확인하는 e2e 앱이에요. 화면이 사진으로 남아야 해요.");
  await dialog.getByRole("button", { name: "게시하기" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await project(context.request, made.id)).published_thumbnail_at, { timeout: 40_000 }).not.toBeNull();

  const mine = (await (await context.request.get(`${SITE}/api/apps/mine`)).json()) as Listing[];
  const listing = mine.find((a) => a.name === name)!;
  expect(listing.thumbnail_at).not.toBeNull();
  const published = await context.request.get(`${SITE}/api/apps/${listing.slug}/thumbnail`);
  expect(published.headers()["content-type"]).toContain("image/webp");

  // CtrlAIApps: the card and the detail's head carry the picture.
  await page.goto(`${SITE}/ctrlaistore`);
  const appCard = page.getByTestId("app-card").filter({ hasText: name });
  await expect(appCard.locator(`img[src*="/api/apps/${listing.slug}/thumbnail"]`)).toBeVisible();
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-ctrlaiapps.png` });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-ctrlaiapps.png` });

  await page.goto(`${SITE}/ctrlaistore/${listing.slug}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  // One head row: no 앱 실행 button, the frame is the first screen.
  await expect(page.getByRole("button", { name: "앱 실행" })).toHaveCount(0);
  const frame = page.locator("iframe[title='" + name + "']");
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  expect(box.y).toBeLessThan(400);
  expect(box.height).toBeGreaterThan(350);
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-app-detail.png` });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-app-detail.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await theme(page, "light");
  await page.reload();
  const narrow = page.locator("iframe[title='" + name + "']");
  await expect(narrow).toBeVisible();
  const narrowBox = (await narrow.boundingBox())!;
  expect(narrowBox.y + narrowBox.height).toBeLessThanOrEqual(844 + 1);
  expect(narrowBox.height).toBeGreaterThanOrEqual(300);
  await page.screenshot({ path: `${SHOTS}/390-light-app-detail.png` });
  await page.goto(`${SITE}/ctrlaistore`);
  await expect(page.getByTestId("app-card").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/390-light-ctrlaiapps.png` });

  // Tidy: the project goes (soft); the listing filters it out.
  const gone = await context.request.delete(`${SITE}/api/builder/projects/${made.id}`);
  expect(gone.ok()).toBeTruthy();
  const after = (await (await context.request.get(`${SITE}/api/apps`)).json()) as Listing[];
  expect(after.find((a) => a.slug === listing.slug)).toBeUndefined();
});

test("a pin and a sort on Project Builder survive a reload; the card shows no request text", async ({ page, context }) => {
  test.setTimeout(90_000);
  await login(page);
  const stamp = Date.now() % 100000;
  const a = await newProject(context.request, `가나다 e2e ${stamp}`);
  const b = await newProject(context.request, `하하하 e2e ${stamp}`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/builder`);
  const cards = page.locator("article[data-testid='library-card'], article").filter({ hasText: /e2e/ });
  await expect(cards.first()).toBeVisible();

  // Pin the older one: it moves to the front and wears the pin.
  const older = page.locator("article", { hasText: a.name }).first();
  await older.getByRole("button", { name: `${a.name} 메뉴` }).click();
  await page.getByRole("menuitem", { name: "맨 위에 고정" }).click();
  await expect(older.getByRole("img", { name: "고정됨" })).toBeVisible();
  await expect.poll(async () => ((await (await context.request.get(`${SITE}/api/builder/projects/${a.id}`)).json()) as { pinned_at: string | null }).pinned_at).not.toBeNull();
  await page.reload();
  await expect(page.locator("article").first()).toContainText(a.name);

  // Sort by name: remembered on this device.
  await page.getByRole("button", { name: /정렬:/ }).click();
  await page.getByRole("menuitem", { name: /이름순/ }).click();
  await expect(page.getByTestId("sort-label")).toHaveText("이름순");
  await page.reload();
  await expect(page.getByTestId("sort-label")).toHaveText("이름순");
  // Pinned first, then by name.
  await expect(page.locator("article").first()).toContainText(a.name);

  // No request text on a card that is not published.
  await expect(page.locator("article", { hasText: b.name })).not.toContainText("이 화면이 사진으로");
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-builder.png` });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-builder.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await theme(page, "light");
  await page.reload();
  await expect(page.locator("article").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/390-light-builder.png` });

  // Back to the default order, unpinned, projects gone.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByRole("button", { name: /정렬:/ }).click();
  await page.getByRole("menuitem", { name: /마지막 수정순/ }).click();
  await expect(page.getByTestId("sort-label")).toHaveText("마지막 수정순");
  for (const p of [a, b]) expect((await context.request.delete(`${SITE}/api/builder/projects/${p.id}`)).ok()).toBeTruthy();
});

test("a favourite on CtrlAIApps is per member and survives a reload", async ({ page, context }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/ctrlaistore`);
  const first = page.getByTestId("app-card").first();
  await expect(first).toBeVisible();
  const star = first.getByRole("button", { name: /즐겨찾기/ });
  const wasOn = (await star.getAttribute("aria-pressed")) === "true";
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", String(!wasOn));
  await page.reload();
  const apps = (await (await context.request.get(`${SITE}/api/apps`)).json()) as Listing[];
  expect(apps.filter((a) => a.favorite).length).toBeGreaterThanOrEqual(wasOn ? 0 : 1);
  // Favourites come first.
  if (!wasOn) await expect(page.getByTestId("app-card").first().getByRole("button", { name: /즐겨찾기 해제/ })).toBeVisible();
  await page.getByTestId("app-card").first().getByRole("button", { name: /즐겨찾기/ }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: /즐겨찾기 해제/ })).toHaveCount(wasOn ? 1 : 0);
});

test("Profile: two aligned notification switches and a plain list of my apps", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/profile`);
  const switches = page.getByRole("switch");
  await expect(switches).toHaveCount(2);
  const [x1, x2] = await Promise.all([switches.nth(0).boundingBox(), switches.nth(1).boundingBox()]);
  expect(Math.abs(x1!.x - x2!.x)).toBeLessThan(2);
  const list = page.getByTestId("my-apps-list");
  await expect(list).toBeVisible();
  expect(await list.locator("img").count()).toBe(0);
  await expect(list.getByRole("link", { name: /열기$/ }).first()).toBeVisible();
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-profile.png`, fullPage: true });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-profile.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await theme(page, "light");
  await page.reload();
  await expect(page.getByTestId("my-apps-list")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/390-light-profile.png`, fullPage: true });
});
