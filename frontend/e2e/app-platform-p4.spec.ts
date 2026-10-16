/**
 * app-platform P4 — a template in the Builder's 미리보기, in a real browser.
 *
 * Needs the local stack (site on 3000, backend with `APPS_BASE_URL`, the
 * apps server on 8300, the dev member). Makes a 동아리 게시판 project from
 * the template through the API, opens it in the Builder, and inside the
 * preview's app frame: the signed-out notice shows, writing a post opens
 * the consent window (named as the Builder 미리보기), 허용 lets the post
 * through, and an AI call is labelled as 미리보기 사용 in the shell's toast.
 * Writes to the dev database.
 */

import { expect, test, type Frame, type Page } from "@playwright/test";

const APPS = process.env.APPS_ORIGIN ?? "http://localhost:8300";
const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";

// A stuck click fails on its own, naming the step, rather than eating the test's whole time.
test.use({ actionTimeout: 20_000 });

async function appFrame(page: Page, slug: string): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(() => (frame = page.frames().find((f) => f.url().includes(`/${slug}/_app/`))) !== undefined, { timeout: 30_000 })
    .toBe(true);
  await frame!.waitForFunction(() => typeof window.ctrlai === "object");
  return frame!;
}

test("동아리 게시판 template: the preview signs the maker in and labels their spend as 미리보기", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const made = await context.request.post(`${SITE}/api/builder/projects/from-template`, {
    data: { template: "club-board", name: `e2e 게시판 ${Date.now().toString(36)}` },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const project = (await made.json()) as { id: number; draft_slug: string | null };
  expect(project.draft_slug).toBeTruthy();
  const slug = project.draft_slug!;

  // A first visit would show the site's guide over the page (FirstVisitGuide).
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("ctrlai.guide-done", "1");
    } catch {
      /* the app frame's origin is opaque: no storage there, and no guide either */
    }
  });
  await page.goto(`${SITE}/builder/${project.id}`);
  const frame = await appFrame(page, slug);
  expect(await frame.evaluate(() => window.ctrlai.app())).toMatchObject({ slug, mode: "preview" });

  // Signed out inside the app: reading works, the notice offers 로그인.
  await expect(frame.getByText(/읽기는 누구나/)).toBeVisible();
  await expect(frame.getByText("아직 글이 없어요", { exact: false })).toBeVisible();

  // Writing a post asks the maker to sign in to their own app (the consent
  // window names the Builder 미리보기), then saves it.
  await frame.getByRole("button", { name: "글쓰기" }).click();
  await frame.getByLabel("제목").fill("첫 공지");
  await frame.getByLabel("내용").fill("미리보기에서 쓴 글이에요.");
  const consentPromise = context.waitForEvent("page");
  await frame.getByRole("button", { name: "올리기" }).click();
  const consent = await consentPromise;
  await consent.waitForLoadState();
  await expect(consent.getByRole("heading", { name: /연결할까요/ })).toBeVisible({ timeout: 45_000 });
  await expect(consent.getByText(/Builder 미리보기/)).toBeVisible();
  await consent.getByRole("button", { name: "허용" }).click();
  await consent.waitForEvent("close", { timeout: 15_000 });
  await expect(frame.getByText("첫 공지")).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByText(/읽기는 누구나/)).toBeHidden();

  // The data went to the preview's own space, declared by ctrlai.json.
  expect(await frame.evaluate(() => window.ctrlai.db.count("posts", { shared: true }))).toBe(1);

  // AI from the preview: the maker's own wallet, labelled 미리보기 사용.
  const answer = await frame.evaluate(() => window.ctrlai.ai.ask({ prompt: "안녕?" }));
  expect(answer.chargedKrw).toBeGreaterThan(0);
  // The Builder adds `?v=` to the shell's address so a refresh reloads it.
  const shell = page.frames().find((f) => f.url().startsWith(`${APPS}/${slug}/`) && !f.url().includes("/_app/"));
  expect(shell).toBeTruthy();
  await expect(shell!.locator("#ctrlai-note")).toHaveText(/미리보기 사용 · \d+원/);
  const usage = (await (await context.request.get(`${SITE}/api/usage/me`)).json()) as { events: { label: string }[] };
  expect(usage.events.some((row) => row.label.startsWith("앱 미리보기 · e2e 게시판"))).toBe(true);
});
