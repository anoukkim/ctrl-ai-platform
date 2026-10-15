/**
 * 비용 보정 — 화면 쪽. 숫자가 맞는지는 백엔드 테스트가 봅니다
 * (`backend/tests/test_cost_calibration.py`).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { toPickerModel, type ChatModelOption } from "@/lib/chat";
import { modelCostText } from "@/lib/depth";

const costLabel = (model: ChatModelOption) => modelCostText(toPickerModel(model));

const getChatCalibration = vi.fn();
const getChatCacheStats = vi.fn();
vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return {
    ...actual,
    getChatCalibration: () => getChatCalibration(),
    getChatCacheStats: () => getChatCacheStats(),
  };
});

const { default: CalibrationPanel } = await import("@/app/admin/ai-models/CalibrationPanel");

const SONNET: ChatModelOption = {
  id: 2,
  model_id: "claude-sonnet-5-5",
  label: "균형 잡힌 답변 (Sonnet 5.5)",
  description: "",
  admin_only: false,
  is_default: true,
  estimated_reply_krw: 20,
};

describe("답장 1회 약 N원", () => {
  test("공식 어림값이면 그대로", () => {
    expect(costLabel({ ...SONNET, estimate_basis: "formula" })).toBe("1회 약 20원");
  });

  test("최근 실제 답장의 중앙값이면 그렇다고 말한다", () => {
    expect(
      costLabel({ ...SONNET, estimated_reply_krw: 7, estimate_basis: "recent", estimate_samples: 12 }),
    ).toBe("1회 약 7원 (최근 실제 기준)");
  });
});

describe("Admin › 비용 보정", () => {
  test("모델마다 어림과 실제, 보정 배수, 중앙값을 보여 준다", async () => {
    getChatCalibration.mockResolvedValue([
      {
        model_id: "claude-sonnet-5-5",
        label: "균형 잡힌 답변 (Sonnet 5.5)",
        samples: 12,
        calibrated: true,
        input_ratio: 0.6,
        input_factor: 0.72,
        avg_prompt_tokens: 600,
        avg_estimated_tokens: 1000,
        avg_output_tokens: 300,
        avg_reply_krw: 7.4,
        median_reply_krw: 7,
        formula_reply_krw: 20,
        cache_hit_rate: 0.75,
      },
    ]);
    getChatCacheStats.mockResolvedValue([
      {
        model_id: "claude-sonnet-5-5",
        label: "균형 잡힌 답변 (Sonnet 5.5)",
        day: "2026-10-14",
        replies: 4,
        cache_hit_replies: 2,
        read_tokens: 12_000,
        saved_krw: 32,
      },
    ]);
    render(<CalibrationPanel />);

    expect(await screen.findByText("1,000 → 600")).toBeTruthy();
    expect(screen.getByText("×0.72")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText(/보정 중/)).toBeTruthy();

    // 캐시 절약 (PART F): 일별 적중률과 아낀 돈.
    expect(await screen.findByText("캐시 절약")).toBeTruthy();
    expect(screen.getByText("12,000 토큰")).toBeTruthy();
    expect(screen.getByText("32원")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
  });
});
