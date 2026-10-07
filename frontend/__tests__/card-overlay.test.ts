/**
 * 카드를 덮는 링크가 단추를 가로채지 않는지.
 *
 * 목록 카드는 `<Link>`가 아니라 평범한 칸이고, 그 위에 카드 전체를 덮는
 * 투명한 링크(`.cardLink`)가 깔립니다. 링크 안에 단추를 넣을 수 없기
 * 때문입니다. 대신 ⋯ 메뉴와 이름 고치는 칸만 그 링크 **위로** 올라와야
 * 합니다. 하나라도 아래로 내려가면 눌러도 아무 일이 일어나지 않고,
 * 프로젝트만 열립니다 — "버튼이 눌리지 않는다"로 보이는 고장입니다.
 *
 * **왜 CSS를 읽어서 검사하는가.** jsdom에는 배치(layout)가 없습니다.
 * 겹침도 없고 `elementFromPoint`도 의미가 없으므로, 평범한 렌더 테스트는
 * 덮개가 단추를 가려도 통과합니다. 실제로 깨지는 자리는 CSS의 쌓임
 * 순서이므로, 그 규칙을 직접 읽어서 고정합니다.
 *
 * 지키는 것은 다섯 가지입니다.
 *
 *   1. 덮개보다 위에 있어야 하는 것들이 정말 위에 있다.
 *   2. 그것들이 `position`을 가진다 — 없으면 `z-index`는 아무 효과가
 *      없고, 숫자만 보고 안심하게 됩니다.
 *   3. `.card` 자체는 쌓임 맥락(stacking context)을 만들지 않는다.
 *      `position: relative`에 `z-index`를 더하면 맥락이 생기고, 그러면
 *      메뉴가 카드 안에 갇혀 다음 카드 밑으로 들어갑니다.
 *   4. 카드가 넘침을 잘라내지 않는다 — 잘라내면 펼친 메뉴가 사라집니다.
 *   5. **열린 카드는 다른 카드의 메뉴보다 위에 있다.** 이것이 카드 하나
 *      안쪽만 보던 처음 판단이 놓친 자리입니다.
 *
 * ## 카드 사이의 겹침
 *
 * `.cardMenu`는 z-index를 가지므로 그 자체가 쌓임 맥락입니다. 그래서 안에
 * 있는 `.cardMenuList`의 z-index 20은 **그 맥락 안에서만** 유효하고,
 * 바깥에서 보면 펼친 메뉴도 결국 `.cardMenu`의 2입니다. 다음 카드의
 * `.cardMenu`도 2이고 DOM에서 뒤에 오므로 — 같은 값끼리는 뒤가 이깁니다 —
 * 펼친 메뉴가 아랫줄 카드의 ⋯ 단추 밑으로 들어갑니다.
 *
 * 실제 브라우저에서 확인한 사실입니다. 두 줄짜리 격자에서 메뉴를 펼치고
 * 겹치는 지점의 `elementFromPoint`를 보면, 고치기 전에는 다음 카드의
 * 글리프가, 고친 뒤에는 `UL.cardMenuList`가 나옵니다. 지금 카드 높이로는
 * 43px 차이로 겨우 비껴가 있을 뿐이므로, 메뉴 항목이 하나 늘거나 카드가
 * 짧아지면 바로 드러납니다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const CSS = readFileSync(
  join(process.cwd(), "app", "components", "library.module.css"),
  "utf-8",
);

/** 한 클래스의 본문을 꺼냅니다. 가장 바깥 블록 하나만 봅니다. */
function rule(selector: string): string {
  const match = CSS.match(
    new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, "m"),
  );
  if (!match) throw new Error(`.${selector} 규칙을 찾지 못했습니다`);
  return match[1];
}

function declaration(selector: string, property: string): string | null {
  const match = rule(selector).match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "m"));
  return match ? match[1].trim() : null;
}

function zIndex(selector: string): number {
  const value = declaration(selector, "z-index");
  if (value === null) throw new Error(`.${selector}에 z-index가 없습니다`);
  return Number(value);
}

/** 덮개 위에 있어야 하는, 사람이 직접 조작하는 것들. */
const ABOVE_THE_OVERLAY = ["cardMenu", "cardNameInput"];

describe("카드를 덮는 링크", () => {
  test("자기 자신은 z-index를 가진다", () => {
    // 없으면 아래 비교가 전부 무의미해집니다.
    expect(zIndex("cardLink")).toBeTypeOf("number");
  });

  test.each(ABOVE_THE_OVERLAY)("%s는 덮개보다 위에 있다", (selector) => {
    expect(zIndex(selector)).toBeGreaterThan(zIndex("cardLink"));
  });

  test.each(ABOVE_THE_OVERLAY)("%s는 position을 가진다", (selector) => {
    // z-index는 position 없는 요소에서 아무 일도 하지 않습니다. 숫자만
    // 올려 두고 고쳤다고 믿는 일을 막습니다.
    expect(declaration(selector, "position")).not.toBeNull();
  });

  test("카드 자체는 쌓임 맥락을 만들지 않는다", () => {
    // position: relative + z-index = 새 맥락. 그러면 ⋯ 메뉴의 z-index가
    // 카드 안에서만 유효해지고, 펼친 메뉴가 옆 카드 밑으로 들어갑니다.
    expect(declaration("card", "position")).toBe("relative");
    expect(declaration("card", "z-index")).toBeNull();
  });

  test("카드는 넘치는 것을 잘라내지 않는다", () => {
    // 잘라내면 카드 밖으로 펼쳐지는 메뉴가 보이지 않습니다.
    const overflow = declaration("card", "overflow");
    expect(overflow === null || overflow === "visible").toBe(true);
  });

  test("펼친 메뉴는 덮개보다 위에 있다", () => {
    expect(zIndex("cardMenuList")).toBeGreaterThan(zIndex("cardLink"));
  });
});

describe("카드 사이의 겹침", () => {
  test("열린 카드는 다른 카드의 메뉴보다 위에 있다", () => {
    // `.cardMenu`가 쌓임 맥락이라 `.cardMenuList`의 20은 바깥에서 보이지
    // 않습니다. 열린 카드 자체가 2를 넘어야 아랫줄 카드에 덮이지 않습니다.
    expect(zIndex("cardOpen")).toBeGreaterThan(zIndex("cardMenu"));
  });

  test("들어 올리는 것은 열렸을 때뿐이다", () => {
    // 항상 올려 두면 카드마다 쌓임 맥락이 생겨, 지금 고친 것과 같은
    // 종류의 문제를 다른 자리에서 다시 만듭니다.
    expect(declaration("card", "z-index")).toBeNull();
    expect(declaration("cardOpen", "z-index")).not.toBeNull();
  });
});
