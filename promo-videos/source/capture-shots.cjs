// Capture the CTRL+AI screens the promo videos show (local dev stack).
//
//   PROJ=<builder project id> node capture-shots.cjs shots dark
//   PROJ=<builder project id> node capture-shots.cjs shots light
//
// Signs in as the dev seed account, sends one Chat message (so it needs a
// 동아리 지원 wallet) and screenshots each page at 1440×900, scale 1.5.
// /video/1 must be a video project with a generated version.
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const OUT = process.argv[2];
const BASE = process.env.BASE || "http://localhost:3000";

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: "ko-KR" });
  const page = await ctx.newPage();
  const theme = process.argv[3] || "dark";
  const only = process.argv[4] || "";
  await ctx.addInitScript((t) => { try { localStorage.setItem("ctrlai-theme", t); } catch {} }, theme);
  const skip = async () => {
    for (let i = 0; i < 3; i++) {
      const b = page.getByRole("button", { name: "건너뛰기" });
      if (await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(400); } else break;
    }
  };
  const shot = async (name) => {
    await page.waitForTimeout(900);
    await skip();
    name = theme + "-" + name;
    await page.screenshot({ path: path.join(OUT, name + ".png") });
    console.log("shot", name);
  };

  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await shot("01-login");
  await page.locator("input").nth(0).pressSequentially("dev", { delay: 30 });
  await page.locator('input[type="password"]').first().fill("devpassword");
  await shot("02-login-filled");
  await page.locator('input[type="password"]').first().press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  await page.waitForLoadState("networkidle");

  if (only !== "pages") {
    await skip();
    await page.getByRole("button", { name: "새 대화" }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await skip();
    const box = page.locator("textarea").first();
    await box.click();
    await box.fill("우리 동아리 회원들이 쓸 독서 기록 앱을 만들고 싶어");
    await shot("04-chat-typed");
    await box.press("Enter");
    await page.waitForTimeout(10000);
    await shot("05-chat-reply");
  }
  for (const [name, route] of [
    ["03-chat-home", "/"],
    ["06-builder", "/builder"],
    ["07-video", "/video"],
    ["07b-video-detail", "/video/1"],
    ["08-apps", "/ctrlaistore"],
    ["09-tube", "/ctrlaitube"],
    ["10-usage", "/usage"],
    ["11-profile", "/profile"],
    ["12-app-detail", "/ctrlaistore/3f44nbz6hv"],
    ["13-builder-project", "/builder/" + (process.env.PROJ || "")],
  ]) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await shot(name);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
