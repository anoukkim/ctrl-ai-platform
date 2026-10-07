/**
 * 모델이 정하는 영상 설정 — `lib/video-settings.ts`의 순수한 계산.
 *
 * video-higgsfield-only의 "Model-driven video settings"가 요구한 테스트
 * 중 계산에 해당하는 것들입니다: 모델을 바꿀 때 무엇을 남기고 무엇을
 * 기본값으로 돌리는지, 예상 비용이 카탈로그 가격과 맞는지.
 */

import { describe, expect, test } from "vitest";

import type { VideoCapabilities } from "@/lib/projects";
import {
  costLabel,
  defaultsOf,
  estimateCostKrw,
  reconcile,
  settingsNotice,
} from "@/lib/video-settings";

const KLING: VideoCapabilities = {
  durations: [5, 10, 15],
  aspect_ratios: ["9:16", "16:9", "1:1"],
  resolutions: ["720p", "1080p"],
  sound: true,
  supports_edit: true,
  supports_extend: true,
  price_per_second_krw: { "720p": 700, "1080p": 1000 },
  defaults: { duration_seconds: 5, aspect_ratio: "9:16", resolution: "720p", sound: true },
  prices_are_examples: true,
};

const SEEDANCE: VideoCapabilities = {
  durations: [5, 10],
  aspect_ratios: ["9:16"],
  resolutions: ["480p", "720p"],
  sound: false,
  supports_edit: false,
  supports_extend: true,
  price_per_second_krw: { "480p": 300, "720p": 500 },
  defaults: { duration_seconds: 5, aspect_ratio: "9:16", resolution: "480p", sound: false },
  prices_are_examples: true,
};

describe("기본값", () => {
  test("처음 열면 모델의 기본값이 골라져 있고 알릴 것이 없다", () => {
    const { choice, changes } = reconcile(null, KLING);
    expect(choice).toEqual(defaultsOf(KLING));
    expect(changes).toEqual([]);
  });
});

describe("모델 바꾸기", () => {
  test("새 모델에도 있는 선택은 그대로 남는다", () => {
    const previous = { duration_seconds: 10, aspect_ratio: "9:16", resolution: "720p", sound: false };

    const { choice, changes } = reconcile(previous, SEEDANCE);

    expect(choice).toEqual(previous);
    expect(changes).toEqual([]);
    expect(settingsNotice(changes)).toBeNull();
  });

  test("없는 선택만 새 모델의 기본값으로 바뀌고, 무엇이 바뀌었는지 알린다", () => {
    const previous = { duration_seconds: 15, aspect_ratio: "16:9", resolution: "1080p", sound: true };

    const { choice, changes } = reconcile(previous, SEEDANCE);

    expect(choice).toEqual({
      duration_seconds: 5,
      aspect_ratio: "9:16",
      resolution: "480p",
      sound: false,
    });
    expect(settingsNotice(changes)).toBe(
      "이 모델에 맞춰 길이를 5초로, 비율을 9:16 세로로, 화질을 480p로, 소리를 끔으로 바꿨습니다.",
    );
  });

  test("되돌아가도 남은 선택은 그대로다", () => {
    const onSeedance = reconcile(
      { duration_seconds: 10, aspect_ratio: "16:9", resolution: "720p", sound: false },
      SEEDANCE,
    ).choice;

    const { choice, changes } = reconcile(onSeedance, KLING);

    // 길이 10초와 화질 720p는 두 모델 모두에 있어 끝까지 살아남습니다.
    expect(choice.duration_seconds).toBe(10);
    expect(choice.resolution).toBe("720p");
    expect(changes).toEqual([]);
  });
});

describe("예상 비용", () => {
  test.each([
    [KLING, "720p", 5, 3_500],
    [KLING, "1080p", 10, 10_000],
    [SEEDANCE, "480p", 10, 3_000],
    [SEEDANCE, "720p", 5, 2_500],
  ])("길이 × 그 화질의 초당 가격", (caps, resolution, seconds, expected) => {
    expect(estimateCostKrw(caps, resolution, seconds)).toBe(expected);
  });

  test("가격이 없는 화질은 0원이 아니라 '모름'이다", () => {
    expect(estimateCostKrw(SEEDANCE, "1080p", 5)).toBeNull();
    expect(costLabel(null)).toBe("");
  });

  test("원 단위로 읽히게 적는다", () => {
    expect(costLabel(10_000)).toBe("예상 10,000원");
  });
});
