/**
 * fix-composer-toolbar — 입력창 아래 "도구" 버튼과 판.
 *
 * 버튼 하나, 켠 개수, 관리자가 열지 않은 도구는 숨김, 모든 가격이 같은 꼴
 * (백엔드가 준 숫자 그대로), 켠 것은 이름 + ✕ 칩, 키보드로 열고 닫기.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import ToolsMenu, { availableTools, toolPrice, type ToolOption } from "@/app/components/ToolsMenu";
import type { ChatModelOption } from "@/lib/chat";

const MODEL = {
  id: 1,
  model_id: "claude-sonnet-5-5",
  label: "균형 잡힌 답변 (Sonnet 5.5)",
  description: "",
  admin_only: false,
  is_default: true,
  estimated_reply_krw: 20,
  tools_web_search: true,
  tools_web_fetch: true,
  tools_code_execution: false,
  web_search_krw_per_call: 14,
  web_fetch_krw_per_use: 7,
  code_execution_krw_per_use: 3,
  thinking_extra_krw: 5,
} as ChatModelOption;

const OFF: Record<ToolOption, boolean> = {
  thinking: false,
  web_search: false,
  web_fetch: false,
  code_execution: false,
};

describe("가격과 보이는 도구", () => {
  test("모든 가격이 같은 꼴, 백엔드 숫자 그대로", () => {
    expect(toolPrice("thinking", MODEL)).toBe("답장마다 +약 5원");
    expect(toolPrice("web_search", MODEL)).toBe("검색 1회 약 14원");
    expect(toolPrice("web_fetch", MODEL)).toBe("읽기 1회 약 7원");
    expect(toolPrice("code_execution", { ...MODEL, tools_code_execution: true })).toBe("약 3원");
    expect(toolPrice("thinking", { ...MODEL, thinking_extra_krw: 0 })).toBe("추가 비용 없음");
    expect(toolPrice("web_search", { ...MODEL, web_search_krw_per_call: 1234 })).toBe("검색 1회 약 1,234원");
  });

  test("관리자가 열지 않은 도구는 숨긴다", () => {
    expect(availableTools(MODEL)).toEqual(["thinking", "web_search", "web_fetch"]);
    expect(availableTools(null)).toEqual([]);
  });
});

describe("도구 버튼과 판", () => {
  test("아무것도 켜지 않으면 '도구'만, 켠 수만큼 숫자와 칩", () => {
    const { rerender } = render(<ToolsMenu model={MODEL} on={OFF} onToggle={vi.fn()} />);
    expect(screen.getByTestId("tools-button").textContent).toBe("도구");
    expect(screen.queryAllByTestId("tool-on-chip")).toHaveLength(0);

    rerender(<ToolsMenu model={MODEL} on={{ ...OFF, thinking: true, web_search: true }} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "도구 2개 켜짐" }).textContent).toBe("도구2");
    const chips = screen.getAllByTestId("tool-on-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual(["생각 과정 보기", "웹 검색"]);
    // 칩에는 가격이 없다.
    expect(chips.some((chip) => /원/.test(chip.textContent ?? ""))).toBe(false);
  });

  test("판의 줄마다 이름 · 설명 · 가격 · 스위치, 숨긴 도구는 줄이 없다", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<ToolsMenu model={MODEL} on={{ ...OFF, web_fetch: true }} onToggle={onToggle} />);

    await user.click(screen.getByTestId("tools-button"));
    expect(screen.getByTestId("tools-button").getAttribute("aria-expanded")).toBe("true");
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    expect(screen.queryByRole("switch", { name: "코드 실행" })).toBeNull();
    expect(screen.getByTestId("tool-price-web_fetch").textContent).toBe("읽기 1회 약 7원");
    expect(screen.getByRole("switch", { name: "페이지 읽기" }).getAttribute("aria-checked")).toBe("true");
    // 열리면 첫 스위치에 초점.
    expect(document.activeElement).toBe(screen.getByRole("switch", { name: "생각 과정 보기" }));

    await user.click(screen.getByRole("switch", { name: "웹 검색" }));
    expect(onToggle).toHaveBeenCalledWith("web_search", true);
  });

  test("✕는 그 도구를 끈다", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<ToolsMenu model={MODEL} on={{ ...OFF, web_search: true }} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "웹 검색 끄기" }));
    expect(onToggle).toHaveBeenCalledWith("web_search", false);
  });

  test("Esc로 닫고 버튼으로 초점이 돌아온다; 바깥을 누르면 닫힌다", async () => {
    const user = userEvent.setup();
    render(<ToolsMenu model={MODEL} on={OFF} onToggle={vi.fn()} />);
    await user.click(screen.getByTestId("tools-button"));
    expect(screen.getByTestId("tools-panel")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("tools-panel")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("tools-button"));

    await user.click(screen.getByTestId("tools-button"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("tools-panel")).toBeNull();
  });

  test("도구를 하나도 쓸 수 없는 모델이면 아무것도 그리지 않는다", () => {
    const { container } = render(<ToolsMenu model={null} on={OFF} onToggle={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
