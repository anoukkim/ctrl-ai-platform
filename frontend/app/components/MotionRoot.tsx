"use client";

/**
 * 모든 움직임의 공통 설정(ui-friendly-motion).
 *
 * `reducedMotion="user"`: 운영체제에서 "움직임 줄이기"를 켠 사람에게는
 * motion 라이브러리가 위치·크기 변화를 하지 않습니다. CSS로 만든 움직임은
 * globals.css의 `prefers-reduced-motion` 규칙이 같은 일을 합니다.
 */

import { MotionConfig } from "motion/react";

export default function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
