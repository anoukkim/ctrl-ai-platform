/**
 * 모든 테스트 앞에 한 번씩 도는 준비 코드.
 *
 * 테스트 사이에 그려 둔 화면을 치웁니다. 치우지 않으면 앞 테스트가 띄운
 * 확인창이 다음 테스트에도 남아 있어, 아무 일도 하지 않은 테스트가
 * 통과합니다 — 가장 나쁜 종류의 통과입니다.
 */

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
