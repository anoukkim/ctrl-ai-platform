/**
 * quality-tuning Q1 — 모델 + 생각 깊이 고르기(Chat과 Builder가 같이 씀).
 * 숫자가 맞는지는 백엔드 테스트가 봅니다(`backend/tests/test_depth.py`);
 * 여기서는 화면이 서버의 값을 그대로 말하는지, 이름만 돌려주는지 봅니다.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import ModelDepthPicker from "@/app/components/ModelDepthPicker";
import { continueText, levelFor, priceText, receiptHead, triggerText, type PickerModel } from "@/lib/depth";

const LEVELS = [
  { level: "low", label: "낮음", hint: "짧은 질문에 빨라요", estimate_krw: 7, max_krw: 200 },
  { level: "medium", label: "보통", hint: "대부분의 질문에 알맞아요", estimate_krw: 10, max_krw: 200 },
  { level: "high", label: "높음", hint: "어려운 문제, 긴 글, 코드에 좋아요", estimate_krw: 18, max_krw: 400 },
  { level: "max", label: "최고", hint: "가장 깊이 생각해요", estimate_krw: 30, max_krw: 800 },
] as const;

const SONNET: PickerModel = {
  id: 2,
  label: "Sonnet 5.5",
  description: "대부분의 질문에 알맞아요.",
  admin_only: false,
  is_default: true,
  estimate_krw: 10,
  levels: LEVELS.map((step) => ({ ...step })),
  flat_max_krw: 200,
  depth_note: "최고에서는 생각을 켜고 답해요 — 시간과 비용이 더 들어요.",
};

const HAIKU: PickerModel = {
  id: 1,
  label: "Haiku 4.5",
  description: "가장 빠르고 저렴해요.",
  admin_only: false,
  is_default: false,
  estimate_krw: 4,
  levels: [],
  flat_max_krw: 200,
  depth_note: "",
};

describe("lib/depth", () => {
  test("단추는 모델 · 깊이, 깊이가 없는 모델은 이름만", () => {
    expect(triggerText(SONNET, "high")).toBe("Sonnet 5.5 · 높음");
    expect(triggerText(HAIKU, "high")).toBe("Haiku 4.5");
  });

  test("값은 서버가 보낸 어림과 한도 그대로", () => {
    expect(priceText(SONNET, "high")).toBe("1회 약 18원 (최대 400원)");
    expect(priceText(HAIKU, "high")).toBe("1회 약 4원 (최대 200원)");
    // feat-auto-continue: the whole reply's ceiling, said only when it is above the call cap.
    expect(continueText({ ...SONNET, levels: SONNET.levels.map((l) => ({ ...l, total_krw: 1500 })) }, "medium")).toBe(
      "길면 자동으로 이어 써요 · 전체 최대 1,500원",
    );
    expect(continueText(SONNET, "medium")).toBe("");
  });

  test("모르는 깊이는 보통으로", () => {
    expect(levelFor(SONNET, null)?.level).toBe("medium");
    expect(levelFor(HAIKU, "max")).toBeNull();
  });

  test("영수증 앞머리", () => {
    expect(receiptHead("Sonnet 5.5", "max")).toBe("Sonnet 5.5 · 최고");
    expect(receiptHead("Haiku 4.5", null)).toBe("Haiku 4.5");
  });
});

describe("ModelDepthPicker", () => {
  test("깊이 막대를 옮기면 이름만 돌려주고, 안내와 값이 바뀐다", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelDepthPicker models={[HAIKU, SONNET]} current={SONNET} level="medium" onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("model-depth-trigger"));
    expect(screen.getByTestId("depth-hint").textContent).toBe("대부분의 질문에 알맞아요");
    expect(screen.getByTestId("depth-price").textContent).toBe("1회 약 10원 (최대 200원)");

    fireEvent.change(screen.getByTestId("depth-slider"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(SONNET, "high");

    rerender(
      <ModelDepthPicker models={[HAIKU, SONNET]} current={SONNET} level="high" onChange={onChange} />,
    );
    expect(screen.getByTestId("depth-hint").textContent).toBe("어려운 문제, 긴 글, 코드에 좋아요");
    expect(screen.getByTestId("depth-price").textContent).toBe("1회 약 18원 (최대 400원)");
  });

  test("최고에서는 생각을 켠다고 말한다", () => {
    render(<ModelDepthPicker models={[SONNET]} current={SONNET} level="max" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("model-depth-trigger"));
    expect(screen.getByText(/최고에서는 생각을 켜고 답해요/)).toBeTruthy();
  });

  test("깊이 조절이 없는 모델은 막대를 숨긴다", () => {
    const onChange = vi.fn();
    render(<ModelDepthPicker models={[HAIKU, SONNET]} current={SONNET} level="high" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("model-depth-trigger"));
    fireEvent.click(screen.getByRole("button", { name: /Haiku 4.5/ }));
    // Haiku에는 깊이가 없어 고른 깊이를 그대로 넘깁니다 — 서버가 무시합니다.
    expect(onChange).toHaveBeenCalledWith(HAIKU, "high");
  });

  test("Haiku를 고른 상태에서는 '깊이 조절이 없어요'", () => {
    render(<ModelDepthPicker models={[HAIKU, SONNET]} current={HAIKU} level="high" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("model-depth-trigger"));
    expect(screen.queryByTestId("depth-slider")).toBeNull();
    expect(screen.getByTestId("no-depth").textContent).toBe("이 모델은 깊이 조절이 없어요.");
  });
});
