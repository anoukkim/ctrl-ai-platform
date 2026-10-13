"use client";

/**
 * 화면을 옮길 때의 짧은 등장 — 살짝 흐렸다가 또렷해집니다
 * (ui-friendly-motion). 160ms로 짧고, 그동안에도 누르고 입력할 수 있습니다.
 *
 * - 위치(transform)는 움직이지 않습니다. transform이 남은 상자는 그 안의
 *   `position: fixed` 창(확인창, 안내 창)을 화면이 아니라 그 상자에 붙여
 *   버리기 때문입니다. 투명도만 바꿉니다.
 * - **처음 열 때는 흐리지 않습니다.** 서버가 그린 화면이 자바스크립트를
 *   기다리며 비어 있지 않도록, 화면을 옮길 때만 씁니다.
 */

import { motion } from "motion/react";
import { useEffect } from "react";

/** 브라우저에서 첫 화면이 그려졌는지. 서버에서는 늘 false입니다. */
let hydrated = false;

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const fade = hydrated;
  useEffect(() => {
    hydrated = true;
  }, []);

  return (
    <motion.div
      className="page-transition"
      initial={fade ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
