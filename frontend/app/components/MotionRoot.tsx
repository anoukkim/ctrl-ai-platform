"use client";

/**
 * 모든 움직임의 공통 설정(ui-friendly-motion).
 *
 * 운영체제에서 "움직임 줄이기"를 켠 사람에게는 **아무것도 움직이지 않습니다**.
 * `reducedMotion="user"`만으로는 위치·크기만 멈추고 흐려짐(opacity)은 그대로
 * 돌기 때문에, 그때는 `MotionGlobalConfig.skipAnimations`로 motion의 모든
 * 애니메이션을 건너뜁니다 — 끝 상태가 바로 그려집니다. 앱을 연 채로 설정을
 * 바꿔도 따라갑니다(`matchMedia`의 change). CSS로 만든 움직임은 globals.css의
 * `prefers-reduced-motion` 규칙이 같은 일을 합니다.
 */

import { MotionConfig, MotionGlobalConfig } from "motion/react";
import { useEffect } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export default function MotionRoot({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    const apply = () => {
      MotionGlobalConfig.skipAnimations = media.matches;
    };
    apply();
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, []);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
