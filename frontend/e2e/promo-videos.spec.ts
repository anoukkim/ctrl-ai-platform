/**
 * promo-videos — the club's intro video, in a real browser.
 *
 * Needs the local stack (backend 8000, `npm run dev` 3000) and the dev
 * member taking part this quarter. Proves (fix-promo-video-placement): the
 * guide's last step always holds the 16:9 cut and CtrlAITube always the
 * 9:16 cut — at 1440 and at 390 alike; no autoplay, muted until asked;
 * CtrlAITube lists the 공식 card and nothing else; a reaction and a comment
 * are stored and come back after a reload. Screenshots land in
 * docs/progress/screens/promo-videos/.
 */

import { expect, test, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";
const SHOTS = "../docs/progress/screens/promo-videos";
const WIDE = /ctrlai-intro-desktop-v1\.mp4$/;
const TALL = /ctrlai-intro-mobile-v1\.mp4$/;

test.use({ actionTimeout: 20_000 });

async function login(page: Page) {
  const login = await page.context().request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
}

async function theme(page: Page, name: "light" | "dark") {
  await page.evaluate((t) => {
    window.localStorage.setItem("ctrlai-theme", t);
    document.documentElement.dataset.theme = t;
  }, name);
}

test("the guide's last step always holds the 16:9 cut: no autoplay, muted until asked", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => window.localStorage.removeItem("ctrlai.guide-done"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/chat`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 4; i++) await dialog.getByRole("button", { name: "다음" }).click();
  await expect(dialog.getByRole("heading", { name: "CTRL+AI 한눈에 보기" })).toBeVisible();
  const video = dialog.locator("video");
  await expect(video).toHaveAttribute("src", WIDE);
  expect(await video.evaluate((v: HTMLVideoElement) => ({ paused: v.paused, muted: v.muted, autoplay: v.autoplay }))).toEqual({
    paused: true,
    muted: true,
    autoplay: false,
  });
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-guide-video.png` });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-guide-video.png` });
  await dialog.getByRole("button", { name: "소리 켜기" }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await dialog.getByRole("button", { name: "시작하기" }).click();
  await expect(dialog).toBeHidden();

  // The phone: still the 16:9 cut.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.localStorage.removeItem("ctrlai.guide-done"));
  await page.reload();
  const again = page.getByRole("dialog");
  for (let i = 0; i < 4; i++) await again.getByRole("button", { name: "다음" }).click();
  await expect(again.locator("video")).toHaveAttribute("src", WIDE);
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/390-light-guide-video.png` });
});

test("CtrlAITube lists only the 공식 card and always plays the 9:16 cut; a reaction and a comment are stored", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("ctrlai.guide-done", "1"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/ctrlaitube`);
  const card = page.getByTestId("official-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("공식");
  // Only real rows: one card, no sample cards.
  await expect(page.locator("a[href^='/ctrlaitube/']")).toHaveCount(1);
  await expect(page.getByText("비 오는 서울의 밤")).toHaveCount(0);
  await expect(page.getByTestId("test-mode")).toHaveCount(0);
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/1440-light-tube-grid.png` });

  await card.click();
  await expect(page).toHaveURL(/\/ctrlaitube\/ctrlai-intro$/);
  await expect(page.getByRole("heading", { level: 1, name: /CTRL\+AI 한눈에 보기/ })).toBeVisible();
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", TALL); // the 9:16 cut, even at 1440
  const box = (await video.boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width); // really a vertical player
  // The file is really served, with the long cache.
  const head = await page.context().request.head(`${SITE}/promo/ctrlai-intro-mobile-v1.mp4`);
  expect(head.ok()).toBeTruthy();
  expect(head.headers()["cache-control"]).toContain("max-age=31536000");

  // A reaction: pressed, counted, and still there after a reload.
  const like = page.getByRole("button", { name: /좋아요/ });
  const wasOn = (await like.getAttribute("aria-pressed")) === "true";
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", String(!wasOn));

  // A comment of my own: stored, shown with 고치기 · 지우기.
  const text = `e2e 댓글 ${Date.now()}`;
  await page.getByLabel("댓글을 남겨보세요").fill(text);
  await page.getByRole("button", { name: "등록" }).click();
  const mine = page.locator("article", { hasText: text });
  await expect(mine).toBeVisible();
  await expect(mine.getByRole("button", { name: "고치기" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1440-light-tube-official.png` });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/1440-dark-tube-official.png` });

  await page.reload();
  await expect(page.locator("article", { hasText: text })).toBeVisible();
  await expect(page.getByRole("button", { name: /좋아요/ })).toHaveAttribute("aria-pressed", String(!wasOn));

  // Tidy: delete the comment, put the reaction back.
  await page.locator("article", { hasText: text }).getByRole("button", { name: "지우기" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "지우기" }).click();
  await expect(page.locator("article", { hasText: text })).toBeHidden();
  await page.getByRole("button", { name: /좋아요/ }).click();
  await expect(page.getByRole("button", { name: /좋아요/ })).toHaveAttribute("aria-pressed", String(wasOn));

  // The phone: the same 9:16 cut, one column.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("video")).toHaveAttribute("src", TALL);
  await theme(page, "light");
  await page.screenshot({ path: `${SHOTS}/390-light-tube-official.png`, fullPage: true });
  await theme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/390-dark-tube-official.png`, fullPage: true });
  await page.goto(`${SITE}/ctrlaitube`);
  await expect(page.getByTestId("official-card")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/390-light-tube-grid.png` });
});
