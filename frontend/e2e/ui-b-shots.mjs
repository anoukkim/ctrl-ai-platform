// Screenshots of the Admin screens ui-improvements B touched. Not a test:
//   node e2e/ui-b-shots.mjs   (servers on 3500/8950, dev/devpassword)
import { chromium } from "@playwright/test";

const SITE = process.env.SITE ?? "http://localhost:3500";
const OUT = "../docs/progress/screens/ui-improvements-b";
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function session(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height } });
  const login = await context.request.post(`${SITE}/api/auth/login`, { data: { username: "dev", password: "devpassword" } });
  if (!login.ok()) throw new Error(`login ${login.status()}`);
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log(`console error @${page.url()}: ${m.text()}`); });
  page.on("pageerror", (e) => console.log(`page error @${page.url()}: ${e.message}`));
  await page.goto(`${SITE}/chat`);
  await page.evaluate((t) => { window.localStorage.setItem("ctrlai-theme", t); window.localStorage.setItem("ctrlai.guide-done", "1"); document.documentElement.dataset.theme = t; }, theme);
  return { context, page };
}

async function shot(page, name, tag) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-${tag}.png`, fullPage: true });
}

for (const [width, height, theme, tag] of [[1440, 900, "light", "1440-light"], [390, 844, "dark", "390-dark"]]) {
  const { context, page } = await session(width, height, theme);

  await page.goto(`${SITE}/admin/ai-models`);
  await page.getByText("모델", { exact: true }).first().waitFor();
  await shot(page, "ai-models", tag);

  await page.goto(`${SITE}/admin/budget`);
  await page.getByRole("button", { name: "제공자별 사용액" }).waitFor();
  await shot(page, "budget-closed", tag);
  await page.getByRole("button", { name: "제공자별 사용액" }).click();
  await shot(page, "budget-providers-open", tag);

  await page.goto(`${SITE}/admin/system`);
  await page.getByTestId("health-strip").waitFor();
  await page.waitForTimeout(1200);
  await shot(page, "system", tag);
  await page.getByRole("button", { name: "채팅 한도" }).click();
  await page.getByTestId("depth-table").waitFor();
  await shot(page, "system-chat-limits-open", tag);

  await page.goto(`${SITE}/admin/deleted`);
  await page.getByText("가계부").first().waitFor();
  await shot(page, "deleted", tag);
  const row = page.getByRole("row", { name: /가계부/ });
  await row.getByRole("button", { name: /관리/ }).click();
  await page.getByRole("menuitem", { name: "완전히 삭제…" }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("textbox").fill("회원이 완전 삭제를 요청함");
  await shot(page, "deleted-purge-dialog", tag);
  await page.keyboard.press("Escape");

  await page.goto(`${SITE}/admin/quarters`);
  const q4 = () => page.getByRole("row", { name: /2026 Q4/ });
  await q4().waitFor();
  await q4().getByRole("button", { name: /관리/ }).click();
  await page.getByRole("menuitem", { name: "신청 기한 연장…" }).click();
  await page.getByRole("dialog").waitFor();
  await shot(page, "quarters-extend-dialog", tag);
  await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForTimeout(500);
  await q4().getByRole("button", { name: /관리/ }).click();
  await page.getByRole("menuitem", { name: "분기 마감…" }).click();
  await page.getByTestId("close-purge").waitFor();
  await shot(page, "quarters-close-dialog", tag);
  await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();

  await context.close();
}
await browser.close();
console.log("done");
