"use client";

/**
 * 게시 완료의 순간 (motion-modern (5)) — "쭈욱 → 팡! + 색종이".
 *
 * 얇은 빛줄기 셋이 아래에서 위로 쭈욱 올라가 터지며 빛살이 퍼지고, 흰 섬광이
 * 한 번, 가운데에서 색종이가 흩날리고, "게시 완료!" 글자가 한 자씩 톡
 * 튀어 오릅니다. 차분한 색(흰빛, 따뜻한 금빛, 라벤더 한 방울). 공룡은
 * 없습니다(오너). 아무것도 기다리게 하지 않아요 — 누르는 것은 그대로
 * 지나가고(pointer-events 없음) 1.9초 뒤 사라집니다. 움직임 줄이기면
 * 글자만 잠깐 보입니다.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import styles from "./celebration.module.css";

export const CELEBRATION_MS = 1900;
const LINES = 3;
const RAYS = 12;
const CONFETTI = 26;
const COLOURS = ["#ffffff", "#ffd98a", "#c9b6ff", "#fff1c2", "#e8dcff"];

/** 한 조각의 길 — 결정적(순서로만), 가운데에서 바깥으로. */
function piece(index: number) {
  const angle = ((index * 360) / CONFETTI + (index % 2) * 11) * (Math.PI / 180);
  const distance = 120 + (index % 5) * 38;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance - 40,
    colour: COLOURS[index % COLOURS.length],
    rotate: (index % 4) * 90 + 45,
    delay: 0.42 + (index % 6) * 0.03,
    tall: index % 3 === 0,
  };
}

export default function PublishCelebration({ text = "게시 완료!", onDone }: { text?: string; onDone: () => void }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setShown(false), reduced ? 1200 : CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {shown && (
        <motion.div
          className={styles.stage}
          data-testid="publish-celebration"
          aria-hidden="true"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        >
          {!reduced && (
            <>
              {Array.from({ length: LINES }, (_, index) => (
                <motion.span
                  key={`l-${index}`}
                  className={styles.line}
                  style={{ left: `calc(50% + ${(index - 1) * 26}px)` }}
                  initial={{ bottom: "-10%", opacity: 0, scaleY: 0.4 }}
                  animate={{ bottom: "52%", opacity: [0, 1, 1, 0], scaleY: [0.4, 1.4, 1, 0.2] }}
                  transition={{ duration: 0.45, delay: index * 0.05, ease: [0.2, 0.9, 0.3, 1] }}
                />
              ))}
              <motion.span
                className={styles.flash}
                initial={{ opacity: 0, scale: 0.2 }}
                animate={{ opacity: [0, 0.85, 0], scale: [0.2, 1.6, 2.2] }}
                transition={{ duration: 0.5, delay: 0.42, ease: "easeOut" }}
              />
              {Array.from({ length: RAYS }, (_, index) => (
                <motion.span
                  key={`r-${index}`}
                  className={styles.ray}
                  style={{ rotate: `${(index * 360) / RAYS}deg` }}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: [0, 1, 0], scaleY: [0, 1, 1.3] }}
                  transition={{ duration: 0.6, delay: 0.44 + (index % 3) * 0.03, ease: "easeOut" }}
                />
              ))}
              {Array.from({ length: CONFETTI }, (_, index) => {
                const p = piece(index);
                return (
                  <motion.span
                    key={`c-${index}`}
                    className={`${styles.confetti} ${p.tall ? styles.confettiTall : ""}`}
                    style={{ background: p.colour }}
                    initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.6 }}
                    animate={{ x: p.x, y: [0, p.y, p.y + 90], opacity: [0, 1, 1, 0], rotate: p.rotate * 2, scale: [0.6, 1, 0.8] }}
                    transition={{ duration: 1.25, delay: p.delay, ease: [0.15, 0.8, 0.4, 1] }}
                  />
                );
              })}
            </>
          )}
          <span className={styles.text}>
            {Array.from(text).map((letter, index) => (
              <motion.span
                key={index}
                className={styles.letter}
                initial={reduced ? false : { opacity: 0, y: 18, scale: 0.6 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 18, delay: 0.5 + index * 0.06 }}
              >
                {letter === " " ? "\u00a0" : letter}
              </motion.span>
            ))}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
