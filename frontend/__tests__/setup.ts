/**
 * 모든 테스트 앞에 한 번씩 도는 준비 코드.
 *
 * 테스트 사이에 그려 둔 화면을 치웁니다. 치우지 않으면 앞 테스트가 띄운
 * 확인창이 다음 테스트에도 남아 있어, 아무 일도 하지 않은 테스트가
 * 통과합니다 — 가장 나쁜 종류의 통과입니다.
 */

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Next의 라우터 자리를 채웁니다.
 *
 * `useRouter`는 앱 라우터가 올라가 있어야 동작하고, jsdom에는 없습니다.
 * 자리를 채우지 않으면 라우터를 쓰는 화면을 그리는 테스트가
 * "invariant expected app router to be mounted"로 터집니다 — 그 화면이
 * 무엇을 보여 주는지와는 아무 상관이 없는 이유로요.
 *
 * 여기 둔 이유: 작업 공간 세 묶음이 같은 자리를 채워야 했고, 앞으로
 * 라우터를 쓰는 화면이 늘 때마다 같은 열 줄을 또 붙이게 됩니다. 특정
 * 경로나 `push` 호출을 들여다봐야 하는 테스트는 파일에서 다시
 * `vi.mock("next/navigation", ...)`으로 덮어쓰면 됩니다 — Admin 쪽
 * 테스트들이 그렇게 하고 있습니다.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
});
