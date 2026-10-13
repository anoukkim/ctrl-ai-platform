"use client";

/**
 * 바뀔 때 부드럽게 세어 가는 숫자 — 지원금 잔액(ui-friendly-motion).
 *
 * 채팅 답장 하나로 잔액이 줄면, 숫자가 0.4초쯤 걸려 새 값까지 내려갑니다.
 * 어디서 돈이 빠졌는지 눈으로 따라갈 수 있게 하려는 것입니다.
 *
 * 처음 그릴 때는 세지 않습니다(새로고침할 때마다 0부터 세면 정신없습니다).
 * 움직임 줄이기를 켠 사람에게는 새 값이 바로 나옵니다.
 */

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

export default function AnimatedNumber({
  value,
  format,
}: {
  value: number;
  format: (value: number) => string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value) return;
    if (reduced) {
      queueMicrotask(() => setShown(value));
      return;
    }
    const controls = animate(from, value, {
      duration: 0.4,
      ease: "easeOut",
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    return () => controls.stop();
  }, [value, reduced]);

  return <span data-testid="animated-number">{format(shown)}</span>;
}
