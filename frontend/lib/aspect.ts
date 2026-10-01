/**
 * 영상의 가로세로 비율.
 *
 * 두 화면이 같은 비율을 다룹니다. Video Generator는 "무엇으로 만들까"로,
 * CtrlAITube는 "만들어진 것을 어떻게 보여줄까"로 쓰지만, 비율 자체와
 * 그것을 CSS에 넘기는 방법은 하나입니다. 같은 뜻의 상수를 두 곳에 두면
 * 한쪽만 고쳐져 어긋나므로 여기에 한 번만 둡니다.
 *
 * `app/video/[projectId]/VideoSettings.tsx`는 이 파일을 다시 내보내기만
 * 합니다 — 그 화면의 기존 import 경로를 그대로 두기 위해서입니다.
 */

export type Aspect = "9:16" | "16:9" | "1:1";

/** 화면에 쓰는 비율 이름. 숫자만으로는 세로인지 가로인지 바로 안 읽힙니다. */
export const ASPECT_LABEL: Record<Aspect, string> = {
  "9:16": "9:16 세로",
  "16:9": "16:9 가로",
  "1:1": "1:1 정사각",
};

/**
 * CSS `aspect-ratio` 값. 그대로 쓰기도 하고, `calc()` 안에서 높이를 너비로
 * 환산하는 배수로도 쓰입니다 — `calc(100cqh * (16 / 9))`처럼 나눗셈이
 * 그대로 계산되기 때문에 두 가지 용도에 같은 값을 넘길 수 있습니다.
 */
export const ASPECT_RATIO_CSS: Record<Aspect, string> = {
  "9:16": "9 / 16",
  "16:9": "16 / 9",
  "1:1": "1 / 1",
};

export const ALL_ASPECTS: Aspect[] = ["9:16", "16:9", "1:1"];
