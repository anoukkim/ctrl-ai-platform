/**
 * ui-improvements — 목록 머리 줄의 공통 격자.
 *
 * 오너의 지적: CtrlAIApps의 검색창 오른쪽 끝이 카드 줄 끝과 맞지 않았고,
 * 네 목록이 각자 다른 줄을 그렸다. 이제 ListToolbar 하나가 그리고, 검색은
 * 오른쪽 끝에 서서 그 끝이 늘 줄 끝(조절 단추가 있으면 그 왼쪽)과 맞는다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import ListToolbar from "@/app/components/ListToolbar";

const CSS = readFileSync(join(process.cwd(), "app", "components", "list-toolbar.module.css"), "utf-8");

function declaration(selector: string, property: string): string | null {
  const body = CSS.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, "m"))?.[1];
  if (!body) throw new Error(`.${selector} 규칙을 찾지 못했습니다`);
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "m"));
  return match ? match[1].trim() : null;
}

describe("ListToolbar", () => {
  test("라벨 · 검색 · 조절 단추의 세 자리를 그린다", () => {
    render(
      <ListToolbar
        label={<span>내 프로젝트 3개</span>}
        search={<input aria-label="검색" />}
        controls={<button type="button">전체</button>}
      />,
    );
    const toolbar = screen.getByTestId("list-toolbar");
    expect(within(toolbar).getByText("내 프로젝트 3개")).toBeTruthy();
    expect(within(toolbar).getByLabelText("검색")).toBeTruthy();
    expect(within(toolbar).getByRole("button", { name: "전체" })).toBeTruthy();
  });

  test("자리가 비면 그 칸을 그리지 않는다 — 검색은 그래도 줄 끝에 선다", () => {
    render(<ListToolbar search={<input aria-label="검색" />} />);
    const toolbar = screen.getByTestId("list-toolbar");
    expect(toolbar.children.length).toBe(1);
  });

  test("CSS 계약: 검색은 오른쪽 끝에, 폭은 --lib-search-max, 세 자리 격자", () => {
    expect(declaration("search", "justify-self")).toBe("end");
    expect(declaration("search", "max-width")).toBe("var(--lib-search-max)");
    expect(declaration("toolbar", "grid-template-areas")).toBe('"label search controls"');
    expect(declaration("controls", "justify-content")).toBe("flex-end");
  });

  test("네 목록이 모두 이 머리 줄을 쓴다", () => {
    for (const file of [
      "app/builder/BuilderLibrary.tsx",
      "app/video/VideoLibrary.tsx",
      "app/ctrlaistore/AppGrid.tsx",
      "app/ctrlaitube/VideoGrid.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf-8");
      expect(source, file).toContain("<ListToolbar");
      expect(source, file).not.toContain('className={`toolbar');
    }
  });
});
