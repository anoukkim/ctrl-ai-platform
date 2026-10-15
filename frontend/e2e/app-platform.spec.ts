/**
 * app-platform P1 — the browser keeps the fences (CTRL+AI 기능 상자).
 *
 * Runs against a live stack (see playwright.config.ts): the apps origin
 * (`APPS_ORIGIN`, the local apps server or Caddy) and the backend
 * (`API_ORIGIN`, only to find two published apps). What is proven here is
 * what a unit test cannot: what a real browser does with the sandbox, the
 * cookies and the messages.
 */

import { expect, request as apiRequest, test, type Frame, type Page } from "@playwright/test";

const APPS = process.env.APPS_ORIGIN ?? "http://localhost:8300";
const API = process.env.API_ORIGIN ?? "http://localhost:8000";
/** A page on another origin, to open a shell from. */
const OTHER = process.env.OTHER_ORIGIN ?? "http://127.0.0.1:8000/";

type Ctrlai = {
  connected: boolean;
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
};
declare global {
  interface Window {
    ctrlai: Ctrlai;
    __w: Window | null;
  }
}

let A = "";
let B = "";

test.beforeAll(async () => {
  const api = await apiRequest.newContext({ baseURL: API });
  const login = await api.post("/api/auth/login", {
    data: { username: process.env.E2E_USER ?? "dev", password: process.env.E2E_PASSWORD ?? "devpassword" },
  });
  expect(login.ok(), "sign in to list the published apps").toBeTruthy();
  const apps = (await (await api.get("/api/apps")).json()) as { slug: string }[];
  expect(apps.length, "two published apps are needed (import_example_apps)").toBeGreaterThanOrEqual(2);
  [A, B] = [apps[0].slug, apps[1].slug];
  await api.dispose();
});

async function appFrame(page: Page, slug: string): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(() => (frame = page.frames().find((f) => f.url().includes(`/${slug}/_app/`))) !== undefined)
    .toBe(true);
  await frame!.waitForFunction(() => typeof window.ctrlai === "object");
  return frame!;
}

async function openApp(page: Page, slug: string): Promise<Frame> {
  await page.goto(`${APPS}/${slug}/`);
  return appFrame(page, slug);
}

test("the app runs sandboxed: opaque origin, no cookies, no network", async ({ page }) => {
  const frame = await openApp(page, A);

  expect(await frame.evaluate(() => window.origin)).toBe("null");
  expect(await frame.evaluate(() => window.ctrlai.connected)).toBe(true);
  const fetched = await frame.evaluate(async () => {
    try {
      await fetch("/_ctrlai/v1/app");
      return "reached";
    } catch {
      return "blocked";
    }
  });
  expect(fetched).toBe("blocked");
  const cookie = await frame.evaluate(() => {
    try {
      return document.cookie;
    } catch {
      return "denied";
    }
  });
  expect(cookie).toBe("denied");
});

test("an app's requests to /_ctrlai never carry the app cookie; the shell's do", async ({ page, context }) => {
  const host = new URL(APPS).hostname;
  await context.addCookies([
    {
      name: `ctrlai_app_${A}`,
      value: "e2e-secret",
      domain: host,
      path: "/_ctrlai/",
      httpOnly: true,
      secure: APPS.startsWith("https"),
      sameSite: "Strict",
    },
  ]);
  const seen: string[] = [];
  page.on("request", async (request) => {
    if (request.url().includes("/_ctrlai/v1/app")) {
      const headers = await request.allHeaders();
      seen.push(`${request.frame() === page.mainFrame() ? "shell" : "app"}:${headers.cookie ?? ""}`);
    }
  });
  const frame = await openApp(page, A);

  // The shell itself (same origin): the cookie goes along.
  const status = await page.evaluate(
    (slug) => fetch("/_ctrlai/v1/app", { headers: { "X-CtrlAI-App": slug } }).then((r) => r.status),
    A,
  );
  expect(status).toBe(200);

  // The app: an image, a form post and finally a navigation of its frame.
  await frame.evaluate(() => {
    new Image().src = "/_ctrlai/v1/app?img";
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/_ctrlai/v1/app?form";
    form.target = "_blank";
    document.body.appendChild(form);
    form.submit();
  });
  await page.waitForTimeout(800);
  await frame.evaluate(() => {
    // Inside the member's app frame, not a Next.js page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.href = "/_ctrlai/v1/app?nav";
  });
  await page.waitForTimeout(800);

  const fromShell = seen.filter((entry) => entry.startsWith("shell:"));
  const fromApp = seen.filter((entry) => !entry.startsWith("shell:"));
  expect(fromShell.some((entry) => entry.includes("e2e-secret"))).toBe(true);
  expect(fromApp.length).toBeGreaterThan(0);
  expect(fromApp.some((entry) => entry.includes("e2e-secret"))).toBe(false);
});

test("app A cannot drive app B's shell", async ({ page, context }) => {
  const frame = await openApp(page, A);
  const popupPromise = context.waitForEvent("page");
  await frame.evaluate((url) => {
    window.__w = window.open(url);
  }, `${APPS}/${B}/`);
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await popup.waitForTimeout(500);
  // Opened from the app, the page inherits the sandbox (opaque origin): the
  // shell's script, same-origin only, does not even load — and were it to
  // run, it refuses without its own origin. Either way: no app, no storage.
  expect(await popup.evaluate(() => window.origin)).toBe("null");
  expect(await popup.locator("iframe").count()).toBe(0);
  await frame.evaluate(() => {
    window.__w?.postMessage({ ctrlai: 1, type: "storage.set", id: "x", key: "from-a", value: 1 }, "*");
  });

  const other = await context.newPage();
  const bFrame = await openApp(other, B);
  expect(await bFrame.evaluate(() => window.ctrlai.storage.get("from-a"))).toBeNull();
});

test("a page that opens a shell in a popup cannot drive it", async ({ page, context }) => {
  await page.goto(OTHER);
  const popupPromise = context.waitForEvent("page");
  await page.evaluate((url) => {
    window.__w = window.open(url);
  }, `${APPS}/${B}/`);
  const popup = await popupPromise;
  const bFrame = await appFrame(popup, B);

  const attempts = await page.evaluate((evil) => {
    const w = window.__w!;
    const message = { ctrlai: 1, type: "storage.set", id: "x", key: "from-opener", value: 1 };
    w.postMessage(message, "*");
    let child = "no frame";
    try {
      w.frames[0].postMessage(message, "*");
      child = "sent";
    } catch {
      child = "blocked";
    }
    let navigation = "allowed";
    try {
      w.frames[0].location.href = evil;
    } catch {
      navigation = "blocked";
    }
    return { child, navigation };
  }, `${OTHER}?evil`);
  await popup.waitForTimeout(800);

  // Whatever the browser let through, the shell took nothing from it …
  expect(await bFrame.evaluate(() => window.ctrlai.storage.get("from-opener"))).toBeNull();
  // … and the app frame was not taken over.
  expect(popup.frames().some((f) => f.url().includes("?evil"))).toBe(false);
  expect(attempts.navigation).toBe("blocked");
});

test("storage is kept per app across reloads; localStorage too", async ({ page }) => {
  let frame = await openApp(page, A);
  await frame.evaluate(async () => {
    await window.ctrlai.storage.set("e2e-key", { n: 1 });
    localStorage.setItem("e2e-ls", "yes");
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  frame = await openApp(page, A);
  expect(await frame.evaluate(() => window.ctrlai.storage.get("e2e-key"))).toEqual({ n: 1 });
  expect(await frame.evaluate(() => localStorage.getItem("e2e-ls"))).toBe("yes");
  const tooBig = await frame.evaluate(() =>
    window.ctrlai.storage.set("e2e-big", "x".repeat(1_100_000)).then(
      () => "stored",
      (error: Error) => error.message,
    ),
  );
  expect(tooBig).toContain("가득");

  const other = await openApp(page, B);
  expect(await other.evaluate(() => window.ctrlai.storage.get("e2e-key"))).toBeNull();
  expect(await other.evaluate(() => localStorage.getItem("e2e-ls"))).toBeNull();

  // Everything the apps saved sits under the shell's per-app prefix.
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.every((key) => key.startsWith("ctrlai:"))).toBe(true);

  frame = await openApp(page, A);
  await frame.evaluate(async () => {
    await window.ctrlai.storage.remove("e2e-key");
    localStorage.removeItem("e2e-ls");
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
});

test("the member's files opened on their own are sandboxed too", async ({ page }) => {
  await page.goto(`${APPS}/${A}/_app/index.html`);
  expect(await page.evaluate(() => window.origin)).toBe("null");
  expect(await page.evaluate(() => window.ctrlai.connected)).toBe(false);
});
