/**
 * Playwright — 실제 브라우저로 확인하는 것들 (app-platform P1).
 *
 * vitest(jsdom)로는 증명할 수 없는 것만 여기에 둡니다: 브라우저가 정말로
 * 샌드박스를 지키는지, 쿠키를 보내지 않는지, 다른 창의 메시지를 셸이
 * 무시하는지. `npm test`에는 들어가지 않습니다 — 띄워 둔 서버가 필요합니다.
 *
 *   백엔드:   APPS_BASE_URL=http://localhost:8300 uvicorn app.main:app --port 8000
 *   앱 주소:  python -m app.dev_apps_server            (또는 Caddy, 아래 APPS_ORIGIN)
 *   예시 앱:  python -m app.db.import_example_apps dev  (게시된 앱이 둘 이상)
 *   실행:     npm run e2e
 *
 * 설치된 Chrome을 씁니다(브라우저를 따로 내려받지 않습니다).
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    headless: true,
    ignoreHTTPSErrors: true,
  },
});
