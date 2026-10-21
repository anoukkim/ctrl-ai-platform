// Screenshots for app-ai-access. Not a test:
//   node e2e/app-ai-access-shots.mjs   (servers on 3500/8950/9000, dev/devpassword, the showcases published)
// The showcase's setting is flipped through the owner's route and put back to 전체 기능 at the end.
import { chromium } from "@playwright/test";

const SITE = process.env.SITE ?? "http://localhost:3500";
const APPS = process.env.APPS ?? "http://localhost:9000";
const OUT = "../docs/progress/screens/app-ai-access";
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function session(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height } });
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: "dev", password: "devpassword" } });
  if (!login.ok()) throw new Error(`login ${login.status()}`);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`page error @${page.url()}: ${e.message}`));
  await page.goto(`${SITE}/chat`);
  await page.evaluate((t) => { window.localStorage.setItem("ctrlai-theme", t); window.localStorage.setItem("ctrlai.guide-done", "1"); document.documentElement.dataset.theme = t; }, theme);
  return { context, page };
}

async function shot(page, name, tag, fullPage = true) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}-${tag}.png`, fullPage });
}

for (const [width, height, theme, tag] of [[1440, 900, "light", "1440-light"], [390, 844, "dark", "390-dark"]]) {
  const { context, page } = await session(width, height, theme);
  const apps = await (await context.request.get(`${SITE}/api/apps`)).json();
  const app = apps.find((a) => a.uses_ai);
  const setAccess = (v) => context.request.post(`${SITE}/api/builder/projects/${app.id}/ai-access`, { data: { ai_access: v } });

  try {
    // 1. The 게시 dialog's question — a fresh, unpublished project whose page calls ctrlai.ai.
    const made = await context.request.post(`${SITE}/api/builder/projects/from-chat`, {
      data: {
        name: `스크린샷 챗봇 ${Date.now().toString(36)}`,
        description: "",
        html: "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><title>챗봇</title></head><body><button id=\"go\">물어보기</button><script>document.getElementById('go').onclick = () => ctrlai.ai.ask({ prompt: '안녕' });</script></body></html>",
      },
    });
    if (!made.ok()) throw new Error(`from-chat ${made.status()} ${await made.text()}`);
    const fresh = await made.json();
    await page.goto(`${SITE}/builder/${fresh.id}`);
    await page.getByRole("button", { name: "CtrlAIApps에 게시" }).waitFor();
    await page.getByRole("button", { name: "CtrlAIApps에 게시" }).click();
    await page.getByTestId("ai-access").waitFor();
    await shot(page, "publish-dialog", tag, false);
    await page.getByRole("button", { name: "취소" }).click();
    await context.request.delete(`${SITE}/api/builder/projects/${fresh.id}`, { data: {} }).catch(() => {});

    // 2. The 게시 menu's switch (the showcase: published, uses AI, the dev user's own).
    await page.goto(`${SITE}/builder/${app.id}`);
    await page.getByRole("button", { name: "게시 메뉴 더 보기" }).waitFor();
    await page.getByRole("button", { name: "게시 메뉴 더 보기" }).click();
    await page.getByText(/AI 기능:/).waitFor();
    await shot(page, "publish-menu", tag, false);
    await page.keyboard.press("Escape");

    // 3. The shell's pill — 전체 기능 live, then the visitor's 데모, then the maker's 데모만.
    await setAccess("full");
    await page.goto(`${APPS}/${app.slug}/`);
    await page.locator("#ctrlai-ai").waitFor();
    await page.waitForTimeout(1500);
    await shot(page, "shell-live", tag, false);
    await page.getByRole("switch", { name: "실제 AI" }).click();
    await shot(page, "shell-visitor-demo", tag, false);
    await setAccess("demo");
    await page.reload();
    await page.locator("#ctrlai-ai").waitFor();
    await page.waitForTimeout(1500);
    await shot(page, "shell-demo-only", tag, false);

    // 4. CtrlAIApps' detail note and Admin › Apps.
    await page.goto(`${SITE}/ctrlaistore/${app.slug}`);
    await page.getByTestId("ai-access-note").waitFor();
    await shot(page, "app-detail-demo-only", tag, false);
    await setAccess("full");
    await page.goto(`${SITE}/admin/apps`);
    await page.getByText(/AI 전체 기능/).first().waitFor();
    await shot(page, "admin-apps", tag, false);
  } finally {
    await setAccess("full");
    await context.close();
  }
}
await browser.close();
console.log("done");
