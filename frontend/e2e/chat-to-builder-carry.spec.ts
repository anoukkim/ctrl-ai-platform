/**
 * chat-to-builder-carry — the 미리보기 goes to the Builder, in a real browser.
 *
 * Mock Claude: "웹 페이지를 만들어 줘" answers with an html 미리보기; a later
 * "… 앱 만들어 줘" answers with the Builder action, which — the conversation
 * now having a 미리보기 — reads 「이 미리보기로 Builder 시작」. It opens a
 * project named by the page, whose index.html is the page and whose SPEC.md
 * holds what the member asked; the first Claude bubble says so.
 * Screenshots → docs/progress/screens/chat-to-builder-carry/.
 */

import { expect, test, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";
const SHOTS = "../docs/progress/screens/chat-to-builder-carry";

test.use({ actionTimeout: 20_000 });

async function login(page: Page) {
  const login = await page.context().request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  await page.addInitScript(() => window.localStorage.setItem("ctrlai.guide-done", "1"));
}

async function say(page: Page, text: string) {
  const box = page.getByLabel("CTRL+AI에게 보낼 메시지");
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "중지", exact: true })).toHaveCount(0, { timeout: 60_000 });
}

test("the action carries the 미리보기, its name and the requests into a new project", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/`);
  await say(page, "웹 페이지를 만들어 줘");
  await expect(page.getByTestId("artifact").first()).toBeVisible();
  await say(page, "가계부 앱 만들어 줘");

  const carry = page.getByTestId("carry-to-builder");
  await expect(carry.getByRole("button", { name: /이 미리보기로 Builder 시작/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1440-chat-carry-button.png` });
  await carry.getByRole("button", { name: /이 미리보기로 Builder 시작/ }).click();

  await expect(page).toHaveURL(/\/builder\/\d+/, { timeout: 30_000 });
  const id = Number(/\/builder\/(\d+)/.exec(page.url())![1]);
  const project = (await (await page.context().request.get(`${SITE}/api/builder/projects/${id}`)).json()) as { name: string };
  // Named by the page, not by the conversation's cut title.
  expect(project.name).not.toMatch(/^웹 페이지를 만들어/);
  const files = (await (await page.context().request.get(`${SITE}/api/builder/projects/${id}/files`)).json()) as { path: string; content: string }[];
  expect(files.map((f) => f.path).sort()).toEqual(["SPEC.md", "index.html"]);
  expect(files.find((f) => f.path === "SPEC.md")!.content).toContain("1. 웹 페이지를 만들어 줘");
  await expect(page.getByTestId("carried-spec")).toContainText("채팅에서 가져왔어요 · 요구사항 1개");
  await page.screenshot({ path: `${SHOTS}/1440-builder-carried.png` });

  const gone = await page.context().request.delete(`${SITE}/api/builder/projects/${id}`, { data: {} });
  expect(gone.ok()).toBeTruthy();
});
