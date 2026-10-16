/**
 * owner-polish-3 — in a real browser.
 *
 * (a2) The 게시 dialog photographs candidates from the 미리보기 (첫 화면 ·
 * 조금 내려간 화면 · 폰 너비), 「지금 화면으로」 adds one, and the pick is the
 * published thumbnail — served to CtrlAIApps and used by the Builder card
 * (`thumbnail_chosen_at`). (c2) The bell sits in the sidebar header, opening
 * it clears the badge, 지우기 empties it; the account row opens a menu.
 * (d) The CtrlAIApps header says what apps can do now.
 */
import { expect, test, type Page } from "@playwright/test";

const SITE = process.env.SITE_ORIGIN ?? "http://localhost:3000";
const USER = process.env.E2E_USER ?? "dev";
const PASSWORD = process.env.E2E_PASSWORD ?? "devpassword";

const HTML =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>색 카드</title>' +
  "<style>body{margin:0;background:#1f6f8b;color:#fff;font:20px system-ui}section{height:900px;padding:24px}" +
  "@media (max-width:600px){body{background:#8b1f5e}}</style></head>" +
  "<body><section><h1>첫 화면</h1><p>위쪽</p></section><section><h1>두 번째 화면</h1><p>아래쪽</p></section></body></html>";

async function signIn(page: Page) {
  const login = await page.context().request.post(`${SITE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("ctrlai.guide-done", "1");
    } catch {
      /* the app frame's origin is opaque */
    }
  });
}

test("(a2) the 게시 dialog offers candidates from the preview and the pick becomes the thumbnail everywhere", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page);
  const request = page.context().request;
  const made = await request.post(`${SITE}/api/builder/projects/from-chat`, {
    data: { name: `색 카드 ${Date.now().toString(36)}`, description: "", html: HTML },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const project = (await made.json()) as { id: number };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/builder/${project.id}`);
  await page.getByRole("button", { name: "CtrlAIApps에 게시" }).click();
  const picker = page.getByTestId("thumbnail-picker");
  await expect(picker).toBeVisible();
  // Three automatic candidates arrive from the sandboxed app, one after another.
  await expect(picker.locator("img")).toHaveCount(3, { timeout: 60_000 });
  await expect(picker.getByRole("radio", { name: /첫 화면/ })).toBeChecked();
  // 「지금 화면으로」 adds a fourth and selects it.
  await picker.getByRole("button", { name: "지금 화면으로" }).click();
  await expect(picker.locator("img")).toHaveCount(4, { timeout: 30_000 });
  await expect(picker.getByRole("radio", { name: /지금 화면/ })).toBeChecked();
  // Pick the phone-width one on purpose and publish.
  await picker.getByRole("radio", { name: /폰 너비/ }).check();
  await page.getByLabel(/CtrlAIApps에 보일 설명/).fill("색 카드예요.");
  await page.getByRole("button", { name: "게시하기" }).click();

  await expect
    .poll(async () => ((await (await request.get(`${SITE}/api/builder/projects/${project.id}`)).json()) as { thumbnail_chosen_at: string | null }).thumbnail_chosen_at, { timeout: 40_000 })
    .not.toBeNull();
  const detail = (await (await request.get(`${SITE}/api/builder/projects/${project.id}`)).json()) as { app_slug: string; published_thumbnail_at: string | null };
  expect(detail.published_thumbnail_at).not.toBeNull();
  const served = await request.get(`${SITE}/api/apps/${detail.app_slug}/thumbnail`);
  expect(served.ok()).toBeTruthy();
  expect(served.headers()["content-type"]).toContain("image/webp");
  const bytes = await served.body();
  expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString()).toBe("WEBP");

  // The Builder card uses the chosen (published) picture, not a draft capture.
  await page.goto(`${SITE}/builder`);
  const card = page.getByRole("link", { name: new RegExp(detail.app_slug ? "색 카드" : "색 카드") }).first();
  await expect(card.locator("img")).toHaveAttribute("src", /space=published/);

  // 썸네일 바꾸기 from the 게시 menu opens the same picker.
  await page.goto(`${SITE}/builder/${project.id}`);
  await page.getByRole("button", { name: "게시 메뉴 더 보기" }).click();
  await page.getByRole("menuitem", { name: /썸네일 바꾸기/ }).click();
  await expect(page.getByRole("dialog", { name: "썸네일 바꾸기" })).toBeVisible();
  await expect(page.getByTestId("thumbnail-picker").locator("img")).toHaveCount(3, { timeout: 60_000 });

  await request.delete(`${SITE}/api/builder/projects/${project.id}`, { data: {} }).catch(() => undefined);
});

test("(c2) the bell in the header clears on open and 지우기 empties it; the account row is a menu; (d) the header", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/ctrlaistore`);
  // (d)
  await expect(page.getByText(/「데모」인 앱은 AI를 부르지 않고/)).toBeVisible();
  await expect(page.getByRole("link", { name: "자세히" })).toHaveAttribute("href", "/help/apps");
  // The bell is beside the name, in the navigation's header.
  const nav = page.getByRole("navigation", { name: "주요 메뉴" });
  const bell = nav.getByRole("button", { name: /^알림/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole("dialog", { name: "알림" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "지우기" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "모두 읽음" })).toHaveCount(0);
  await expect(page.getByTestId("notification-count")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // The account row opens the menu with 로그아웃 last; the old footer icons are gone.
  await nav.getByRole("button", { name: /계정 메뉴/ }).click();
  const items = page.getByRole("menu").getByRole("menuitem");
  await expect(items.last()).toContainText("로그아웃");
  await expect(nav.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Collapsed rail: the avatar still opens the menu and nothing overlaps.
  await page.getByRole("button", { name: "사이드바 접기" }).click();
  await nav.getByRole("button", { name: /계정 메뉴/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "사이드바 펼치기" }).click();
  // Phone width: the menu lives inside the slide-down navigation.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "메뉴" }).click();
  await nav.getByRole("button", { name: /계정 메뉴/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
});
