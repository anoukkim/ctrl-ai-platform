"use client";

/**
 * 오로라 카드 (motion-modern (1)) — 코드가 흘러내리는 대신.
 *
 * 오너: "미리보기 생성 같은거 할때 약간 중간부터 좀 생략해도 될 것 같아…
 * 생성 중 뭔가 오로라 같은거". Claude가 미리보기의 코드를 쓰는 동안(채팅의
 * html 블록), 그리고 Builder가 파일을 쓰는 동안 이 카드가 그 자리에 있습니다:
 * 느리게 흐르는 오로라 위에 "미리보기 만드는 중…", 흐르는 초, 지금까지의
 * 비용, 단계 칩 두셋. 끝나면 오로라가 미리보기로 녹아듭니다(AuroraReveal).
 * 코드는 "코드 보기" 아래로 접힙니다. 움직임 줄이기면 오로라는 멈추고 글과
 * 초는 그대로입니다(globals.css의 전체 규칙).
 */

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { formatKrw } from "@/lib/quarters";

import WorkingSince from "./WorkingSince";

import styles from "./aurora.module.css";

export interface AuroraChip {
  label: string;
  state: "done" | "now" | "todo";
}

interface Props {
  title?: string;
  /** 시작 시각 — 초가 흐릅니다. 없으면 초는 없습니다. */
  since?: number | null;
  /** 지금까지의 비용(원) — 어림값. 없으면 줄이 없습니다. */
  costKrw?: number | null;
  chips?: AuroraChip[];
  /** 카드의 높이 — 채팅 블록은 낮게, 미리보기 덮개는 그 자리를 다 채웁니다. */
  size?: "block" | "fill";
}

export default function AuroraCard({ title = "미리보기 만드는 중…", since = null, costKrw = null, chips = [], size = "block" }: Props) {
  // 시작 시각을 받지 않으면 이 카드가 나타난 순간부터 셉니다 — Builder는
  // 파일을 쓰는 동안만 카드를 올리므로 그게 곧 시작 시각입니다.
  const [mountedAt] = useState(() => Date.now());
  return (
    // Not a live region: the seconds change every second and would be read
    // out each time. The Builder's PlanCard and Chat's own status line
    // already announce that work is going on.
    <div className={`${styles.card} ${size === "fill" ? styles.fill : ""}`} data-testid="aurora-card">
      <span className={styles.aurora} aria-hidden="true">
        <span className={styles.blob} />
        <span className={`${styles.blob} ${styles.blob2}`} />
        <span className={`${styles.blob} ${styles.blob3}`} />
      </span>
      <div className={styles.body}>
        <p className={styles.title}>
          <span className={styles.titleText}>{title}</span>
          <WorkingSince since={since ?? mountedAt} className={styles.seconds} />
        </p>
        {chips.length > 0 && (
          <ul className={styles.chips} aria-label="단계">
            {chips.map((chip) => (
              <li key={chip.label} className={styles.chip} data-state={chip.state}>
                {chip.state === "done" ? "✓ " : chip.state === "now" ? "• " : ""}
                {chip.label}
              </li>
            ))}
          </ul>
        )}
        {costKrw !== null && costKrw !== undefined && (
          <p className={styles.cost} data-testid="aurora-cost">
            지금까지 약 {formatKrw(costKrw)}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 끝난 뒤의 등장: 오로라가 녹아 미리보기가 됩니다 — 흐림이 걷히며 나타납니다.
 * 움직임 줄이기면 그냥 나타납니다.
 */
export function AuroraReveal({ children, className, play = true }: { children: React.ReactNode; className?: string; play?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced || !play ? false : { opacity: 0, filter: "blur(10px)", scale: 0.985 }}
      animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
      transition={{ duration: 0.55, ease: [0.2, 0.7, 0.2, 1] }}
      data-testid="aurora-reveal"
    >
      {children}
    </motion.div>
  );
}

/** 코드에 무엇이 들어왔는지로 단계 칩을 만듭니다 — 뼈대 · 스타일 · 동작. */
export function chipsFromCode(code: string): AuroraChip[] {
  const lower = code.toLowerCase();
  const hasStyle = lower.includes("<style") || lower.includes("style=");
  const hasScript = lower.includes("<script");
    // In order: a later step arriving finishes every earlier one.
  if (hasScript) {
    return [
      { label: "뼈대", state: "done" },
      { label: "스타일", state: "done" },
      { label: "동작", state: "now" },
    ];
  }
  if (hasStyle) {
    return [
      { label: "뼈대", state: "done" },
      { label: "스타일", state: "now" },
      { label: "동작", state: "todo" },
    ];
  }
  // Before any style or script, the first step is "now" from the first byte.
  return [
    { label: "뼈대", state: "now" },
    { label: "스타일", state: "todo" },
    { label: "동작", state: "todo" },
  ];
}
