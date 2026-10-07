/**
 * Video Generator의 생성 설정 — 모델이 정합니다.
 *
 * 길이·비율·화질·소리는 고른 Higgsfield 모델의 카탈로그 항목을 그대로
 * 따릅니다. 모델이 주지 않는 선택지는 화면에 아예 나오지 않고, 백엔드는
 * 카탈로그 밖의 값을 거절합니다(`app/services/video_catalog.py`).
 *
 * 여기 있는 것은 전부 순수한 계산입니다. 작업 공간과 테스트가 같은 함수를
 * 씁니다 — 특히 예상 비용은 백엔드가 실제로 차감하는 식과 같아야 합니다:
 * `초 × 화질별 초당 가격`.
 */

import { ASPECT_LABEL, type Aspect } from "@/lib/aspect";
import type { VideoCapabilities, VideoVersionKind } from "@/lib/projects";
import { formatKrw } from "@/lib/quarters";

/** 한 번의 생성에 쓰는 설정. 백엔드의 `VideoVersionCreate`와 같은 이름입니다. */
export interface VideoChoice {
  duration_seconds: number;
  aspect_ratio: string;
  resolution: string;
  sound: boolean;
}

/** 모델의 기본값. 모델을 처음 열었을 때 미리 골라 둡니다. */
export function defaultsOf(caps: VideoCapabilities): VideoChoice {
  return { ...caps.defaults, sound: caps.sound && caps.defaults.sound };
}

function aspectName(value: string): string {
  return ASPECT_LABEL[value as Aspect] ?? value;
}

/**
 * 고른 값을 다른 모델에 맞춥니다.
 *
 * 새 모델에도 있는 값은 그대로 두고, 없는 값만 새 모델의 기본값으로
 * 바꿉니다. 무엇이 바뀌었는지를 `changes`로 돌려주어 화면이 한 줄로
 * 알릴 수 있게 합니다 — 조용히 바꾸면 결과가 예상과 달라집니다.
 *
 * `previous`가 없으면(처음 여는 경우) 기본값을 그대로 쓰고, 알릴 것도
 * 없습니다.
 */
export function reconcile(
  previous: VideoChoice | null,
  caps: VideoCapabilities,
): { choice: VideoChoice; changes: string[] } {
  const defaults = defaultsOf(caps);
  if (!previous) return { choice: defaults, changes: [] };

  const changes: string[] = [];
  const choice = { ...previous };

  if (!caps.durations.includes(previous.duration_seconds)) {
    choice.duration_seconds = defaults.duration_seconds;
    changes.push(`길이를 ${choice.duration_seconds}초로`);
  }
  if (!caps.aspect_ratios.includes(previous.aspect_ratio)) {
    choice.aspect_ratio = defaults.aspect_ratio;
    changes.push(`비율을 ${aspectName(choice.aspect_ratio)}로`);
  }
  if (!caps.resolutions.includes(previous.resolution)) {
    choice.resolution = defaults.resolution;
    changes.push(`화질을 ${choice.resolution}로`);
  }
  if (previous.sound && !caps.sound) {
    choice.sound = false;
    changes.push("소리를 끔으로");
  }
  return { choice, changes };
}

/** `reconcile`의 변경 목록을 한 문장으로. 바뀐 것이 없으면 null. */
export function settingsNotice(changes: string[]): string | null {
  return changes.length > 0 ? `이 모델에 맞춰 ${changes.join(", ")} 바꿨습니다.` : null;
}

/**
 * 예상 비용(원) — `초 × 그 화질의 초당 가격`.
 *
 * 백엔드가 차감하는 금액과 같은 식입니다. 화질에 가격이 없으면 null을
 * 돌려줍니다: 0원이라고 적으면 무료로 읽힙니다.
 */
export function estimateCostKrw(
  caps: VideoCapabilities,
  resolution: string,
  seconds: number,
): number | null {
  const price = caps.price_per_second_krw[resolution];
  return price === undefined ? null : price * seconds;
}

/** "예상 7,000원". 값을 모르면 빈 문자열. */
export function costLabel(value: number | null): string {
  return value === null ? "" : `예상 ${formatKrw(value)}`;
}

/** 버전이 어떻게 만들어졌는지. 버전 줄에 그대로 나옵니다. */
export const VERSION_KIND_LABEL: Record<VideoVersionKind, string> = {
  generate: "생성",
  edit: "수정",
  extend: "이어서",
};
