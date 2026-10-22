/**
 * auto-depth — the picker's 자동 (추천) switch.
 *
 * 자동 is on by default; the button says "· 자동" and the price is 자동's
 * (보통's estimate, 높음's cap). Turning it off lands on 보통; pressing a
 * slider stop chooses that depth by hand; turning it on again sends "auto".
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import ModelDepthPicker from "@/app/components/ModelDepthPicker";
import { type PickerModel, receiptHead, triggerText } from "@/lib/depth";

const step = (level: "low" | "medium" | "high" | "max", label: string, estimate: number, max: number) => ({
  level,
  label,
  hint: `${label} 안내`,
  estimate_krw: estimate,
  max_krw: max,
  total_krw: max * 5,
});

const SONNET: PickerModel = {
  id: 2,
  label: "Sonnet 5.5",
  description: "균형",
  admin_only: false,
  is_default: true,
  estimate_krw: 20,
  levels: [step("low", "낮음", 14, 200), step("medium", "보통", 20, 200), step("high", "높음", 36, 400), step("max", "최고", 60, 800)],
  auto: { level: "auto", label: "자동", hint: "요청에 맞춰 낮음 · 보통 · 높음 중에서 골라요", estimate_krw: 20, max_krw: 400, total_krw: 3000 },
  flat_max_krw: 200,
  depth_note: "",
};

const HAIKU: PickerModel = { ...SONNET, id: 1, label: "Haiku 4.5", levels: [], auto: null };

describe("자동 (추천)", () => {
  test("기본은 자동 — 단추와 가격이 자동의 값", async () => {
    const onChange = vi.fn();
    render(<ModelDepthPicker models={[SONNET]} current={SONNET} level="auto" onChange={onChange} />);
    expect(screen.getByTestId("model-depth-trigger").textContent).toContain("Sonnet 5.5 · 자동");
    await userEvent.click(screen.getByTestId("model-depth-trigger"));
    const toggle = screen.getByTestId("depth-auto-switch") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByTestId("depth-price").textContent).toBe("1회 약 20원 (최대 400원)");
    // Off → 보통.
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(SONNET, "medium");
  });

  test("막대의 칸을 누르면 직접 고르기, 다시 켜면 auto", async () => {
    const onChange = vi.fn();
    render(<ModelDepthPicker models={[SONNET]} current={SONNET} level="high" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("model-depth-trigger"));
    const toggle = screen.getByTestId("depth-auto-switch") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "낮음" }));
    expect(onChange).toHaveBeenLastCalledWith(SONNET, "low");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(SONNET, "auto");
  });

  test("깊이가 없는 모델에는 자동 스위치도 없다", async () => {
    render(<ModelDepthPicker models={[HAIKU]} current={HAIKU} level="auto" onChange={vi.fn()} />);
    await userEvent.click(screen.getByTestId("model-depth-trigger"));
    expect(screen.queryByTestId("depth-auto-switch")).toBeNull();
    expect(screen.getByTestId("no-depth")).toBeTruthy();
    expect(triggerText(HAIKU, "auto")).toBe("Haiku 4.5");
  });

  test("영수증은 자동이 고른 깊이를 함께 말한다", () => {
    expect(receiptHead("Sonnet 5.5", "high", true)).toBe("Sonnet 5.5 · 자동 · 높음");
    expect(receiptHead("Sonnet 5.5", "high")).toBe("Sonnet 5.5 · 높음");
  });
});
