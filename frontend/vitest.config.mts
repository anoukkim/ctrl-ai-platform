/**
 * Vitest — 프런트엔드 테스트.
 *
 * 백엔드에는 pytest가 있었지만 프런트엔드에는 테스트를 돌릴 것이 없었
 * 습니다. admin-restructure가 "확인창이 변경 전에 뜨는지"를 테스트로
 * 요구하면서 들여놓았습니다. 사람이 눈으로 확인하는 것으로는, 다음에
 * 누군가 확인창을 지나치는 길을 만들어도 아무것도 막지 못합니다.
 *
 * `jsdom`에서 돌아갑니다 — 실제 브라우저가 아니라 브라우저 흉내를 내는
 * 환경이고, 버튼을 누르고 화면에 무엇이 떴는지 보는 데는 충분합니다.
 * 백엔드는 부르지 않습니다: 테스트가 네트워크를 타면 백엔드가 꺼져
 * 있을 때 실패하고, 그러면 테스트가 무엇을 증명하는지 알 수 없습니다.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // `@/`로 시작하는 경로를 tsconfig와 같은 규칙으로 풀어 줍니다. Vite가
    // 직접 지원하므로 따로 플러그인을 쓰지 않습니다.
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["__tests__/**/*.test.tsx", "__tests__/**/*.test.ts"],
    setupFiles: ["./__tests__/setup.ts"],
  },
});
