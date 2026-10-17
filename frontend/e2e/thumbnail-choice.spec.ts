/**
 * thumbnail-choice + publish-done-popup — in a real browser.
 *
 * 지정하기 lays a 16:10 frame over the 미리보기 while the app stays usable
 * (a click on the app goes through); 「이 화면으로」 takes this tab's real
 * pixels (Chrome is told to accept the current tab without the picker) or,
 * where it cannot, the upload fallback is offered; the chosen picture is on
 * the Builder card until 자동으로 되돌리기. Publishing shows the 게시했어요
 * card bottom right with 열어 보기 / 링크 복사, never over the composer.
 * Screenshots land in docs/progress/screens/batch-thumbs-popup/.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";
const SHOTS = "../docs/progress/screens/batch-thumbs-popup";

test.use({
  actionTimeout: 20_000,
  launchOptions: { args: ["--auto-accept-this-tab-capture", "--auto-select-tab-capture-source-by-title=CTRL+AI"] },
});

type Project = { id: number; thumbnail_chosen_at: string | null; draft_thumbnail_at: string | null };

const HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>e2e</title>
<style>body{margin:0;font-family:sans-serif;background:#e0f2fe}main{padding:32px}
h1{color:#0369a1;font-size:40px}button{font-size:20px;padding:10px 18px}</style></head>
<body><main><h1 id="t">썸네일 지정 e2e</h1><button id="b" onclick="document.getElementById('t').textContent='눌렀어요'">누르기</button></main></body></html>`;

async function login(page: Page) {
  const login = await page.context().request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  await page.addInitScript(() => window.localStorage.setItem("ctrlai.guide-done", "1"));
}

async function project(request: APIRequestContext, id: number): Promise<Project> {
  return (await (await request.get(`${SITE}/api/builder/projects/${id}`)).json()) as Project;
}

test("지정하기: the frame leaves the app usable; the chosen picture shows on the card until 자동으로 되돌리기", async ({ page, context }) => {
  test.setTimeout(150_000);
  await login(page);
  const name = `e2e 썸네일 지정 ${Date.now() % 100000}`;
  const created = await context.request.post(`${SITE}/api/builder/projects/from-chat`, { data: { name, description: "", html: HTML } });
  expect(created.status()).toBe(201);
  const made = (await created.json()) as Project;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/builder/${made.id}`);
  const panel = page.getByTestId("thumbnail-panel");
  await expect(panel.getByText("자동", { exact: true })).toBeVisible();
  await expect.poll(async () => (await project(context.request, made.id)).draft_thumbnail_at, { timeout: 40_000 }).not.toBeNull();

  await panel.getByRole("button", { name: /지정하기/ }).click();
  const frame = page.getByTestId("thumbnail-frame");
  await expect(frame).toBeVisible();
  // The app under the frame still takes clicks.
  // The preview is the app shell; the member's files run in its own frame.
  const app = page.frameLocator("iframe[title='앱 미리보기']").frameLocator("iframe").first();
  await app.locator("#b").click();
  await expect(app.locator("#t")).toHaveText("눌렀어요");
  // The frame moves by its bar (and stays 16:10).
  const mover = page.getByRole("button", { name: /틀 옮기기/ });
  const before = (await mover.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 120, before.y + before.height / 2 - 60, { steps: 6 });
  await page.mouse.up();
  const after = (await mover.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 60);
  await page.screenshot({ path: `${SHOTS}/1440-thumbnail-frame.png` });

  const shoot = page.getByRole("button", { name: /이 화면으로/ });
  let chosenBy = "capture";
  if (await shoot.count()) {
    await shoot.click();
    // Either the capture worked (the frame closes) or the fallback is offered.
    await expect
      .poll(async () => ((await frame.count()) === 0 ? "closed" : (await frame.getByRole("alert").count()) > 0 ? "alert" : "waiting"), { timeout: 20_000 })
      .not.toBe("waiting");
  }
  if (await frame.count()) {
    chosenBy = "upload";
    await expect(frame.getByRole("alert")).toContainText("스크린샷을 올리거나");
    test.info().annotations.push({ type: "capture-refused", description: (await frame.getByRole("alert").textContent()) ?? "" });
    const picture = await page.screenshot({ clip: { x: 300, y: 200, width: 640, height: 400 } });
    await frame.locator("input[type=file]").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: picture });
    await expect(frame).toHaveCount(0);
  }
  test.info().annotations.push({ type: "chosen-by", description: chosenBy });
  const chosen = await project(context.request, made.id);
  expect(chosen.thumbnail_chosen_at).not.toBeNull();
  await expect(panel.getByText("직접 지정")).toBeVisible();
  const served = await context.request.get(`${SITE}/api/builder/projects/${made.id}/thumbnail?space=draft`);
  expect(served.headers()["content-type"]).toContain("image/webp");
  await page.screenshot({ path: `${SHOTS}/1440-thumbnail-chosen.png` });

  await page.goto(`${SITE}/builder`);
  const card = page.locator("article", { hasText: name }).first();
  await expect(card.locator(`img[src*="v=${encodeURIComponent(chosen.thumbnail_chosen_at!)}"]`)).toBeVisible();

  await page.goto(`${SITE}/builder/${made.id}`);
  await page.getByTestId("thumbnail-panel").getByRole("button", { name: /자동으로 되돌리기/ }).click();
  await expect(page.getByTestId("thumbnail-panel").getByText("자동", { exact: true })).toBeVisible();
  expect((await project(context.request, made.id)).thumbnail_chosen_at).toBeNull();

  // 게시 → the 게시했어요 card, bottom right, clear of the composer.
  await page.getByRole("button", { name: "CtrlAIApps에 게시" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/CtrlAIApps에 보일 설명/).fill("썸네일 지정을 확인하는 e2e 앱이에요. 화면을 골라 찍어요.");
  await dialog.getByRole("button", { name: "게시하기" }).click();
  const done = page.getByTestId("publish-celebration");
  await expect(done).toBeVisible({ timeout: 30_000 });
  await expect(done).toContainText("게시했어요");
  await expect(done).toContainText(`${name} · CtrlAIApps`);
  await expect(done.getByRole("link", { name: /열어 보기/ })).toHaveAttribute("href", /\/$/);
  await expect(done.getByRole("button", { name: /링크 복사/ })).toBeVisible();
  const cardBox = (await done.boundingBox())!;
  expect(cardBox.x + cardBox.width).toBeGreaterThan(1440 - 40);
  const composer = page.getByRole("textbox").last();
  const composerBox = await composer.boundingBox();
  if (composerBox) expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(composerBox.y + 1);
  await page.waitForTimeout(700); // the card's spring in
  await page.screenshot({ path: `${SHOTS}/1440-publish-done.png` });
  await done.getByRole("button", { name: "닫기" }).click();
  await expect(done).toHaveCount(0);

  // Tidy, so the listing's first app is not this 데모만 one for the next spec.
  const gone = await context.request.delete(`${SITE}/api/builder/projects/${made.id}`, { data: {} });
  expect(gone.ok()).toBeTruthy();
});
