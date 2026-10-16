// Screenshots for owner-polish-3. Not a test:
//   node e2e/owner-polish-3-shots.mjs   (servers on 3500/8950/9000, dev/devpassword)
import { chromium } from "@playwright/test";

const SITE = process.env.SITE ?? "http://localhost:3500";
const OUT = "../docs/progress/screens/owner-polish-3";
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function session(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height } });
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: "dev", password: "devpassword" } });
  if (!login.ok()) throw new Error(`login ${login.status()}`);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`page error @${page.url()}: ${e.message}`));
  await page.goto(`${SITE}/chat`);
  await page.evaluate((t) => { window.localStorage.setItem("ctrlai-theme", t); window.localStorage.setItem("ctrlai.guide-done", "1"); window.localStorage.removeItem("ctrlai.sidebar-collapsed"); document.documentElement.dataset.theme = t; }, theme);
  return { context, page };
}

async function shot(page, name, tag, fullPage = false) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-${tag}.png`, fullPage });
}

for (const [width, height, theme, tag] of [[1440, 900, "light", "1440-light"], [390, 844, "dark", "390-dark"]]) {
  const { context, page } = await session(width, height, theme);
  const phone = width < 600;

  // A notification to show in the bell: a reaction on the dev user's own video needs another member;
  // simplest is a publish row — publish the showcase again is heavy, so seed one row through the API is not
  // possible (the browser never creates rows). We show the bell with whatever exists.
  await page.goto(`${SITE}/ctrlaistore`);
  await page.getByRole("heading", { name: "CtrlAIApps" }).waitFor();
  if (phone) await page.getByRole("button", { name: "메뉴" }).click();
  await shot(page, "sidebar", tag);
  await page.getByRole("button", { name: /^알림/ }).click();
  await page.getByRole("dialog", { name: "알림" }).waitFor();
  await shot(page, "bell-open", tag);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /계정 메뉴/ }).click();
  await page.getByRole("menu").waitFor();
  await shot(page, "account-menu", tag);
  await page.keyboard.press("Escape");
  if (!phone) {
    await page.getByRole("button", { name: "사이드바 접기" }).click();
    await page.getByRole("button", { name: /계정 메뉴/ }).click();
    await page.getByRole("menu").waitFor();
    await shot(page, "collapsed-account-menu", tag);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "사이드바 펼치기" }).click();
  }

  // (d) the header, (a) the covers.
  await shot(page, "ctrlaiapps-header", tag);
  await page.goto(`${SITE}/builder`);
  await page.getByRole("heading", { name: "Project Builder" }).waitFor();
  await page.waitForTimeout(800);
  await shot(page, "builder-covers", tag);

  // (a2) the 게시 dialog's picker on a fresh project.
  const made = await context.request.post(`${SITE}/api/builder/projects/from-chat`, {
    data: {
      name: `색 카드 ${Date.now().toString(36)}`,
      description: "",
      html: "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><title>색 카드</title><style>body{margin:0;background:#1f6f8b;color:#fff;font:20px system-ui}section{height:900px;padding:24px}@media (max-width:600px){body{background:#8b1f5e}}</style></head><body><section><h1>첫 화면</h1><p>위쪽</p></section><section><h1>두 번째 화면</h1><p>아래쪽</p></section></body></html>",
    },
  });
  if (made.ok()) {
    const fresh = await made.json();
    await page.goto(`${SITE}/builder/${fresh.id}`);
    await page.getByRole("button", { name: "CtrlAIApps에 게시" }).waitFor();
    await page.getByRole("button", { name: "CtrlAIApps에 게시" }).click();
    await page.getByTestId("thumbnail-picker").waitFor();
    await page.waitForTimeout(6000);
    await shot(page, "publish-thumbnail-picker", tag);
    await page.getByRole("button", { name: "취소" }).click();
    await context.request.delete(`${SITE}/api/builder/projects/${fresh.id}`, { data: {} }).catch(() => {});
  }

  // (b) Admin › System › 환율, (a) Admin › Apps › 썸네일 만들기.
  await page.goto(`${SITE}/admin/system`);
  await page.getByRole("button", { name: "환율" }).waitFor();
  await page.getByRole("button", { name: "환율" }).click();
  await page.getByTestId("fx-status").waitFor();
  await shot(page, "admin-system-fx", tag);
  await page.goto(`${SITE}/admin/apps`);
  await page.getByTestId("thumbnail-maker").waitFor();
  await shot(page, "admin-apps-thumbnails", tag);

  await context.close();
}
await browser.close();
console.log("done");
