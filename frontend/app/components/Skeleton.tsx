/**
 * 불러오는 동안 보여 주는 회색 막대(ui-friendly-motion).
 *
 * "불러오는 중…" 글자 대신 곧 나타날 내용의 모양을 보여 줍니다. 글자는
 * 화면 읽기 프로그램을 위해 숨겨서 남겨 둡니다 — 눈으로는 막대가 보이고,
 * 귀로는 "불러오는 중"이 들립니다.
 *
 * 반짝임은 `prefers-reduced-motion`이면 멈춥니다(skeleton.module.css).
 */

import styles from "./skeleton.module.css";

export default function Skeleton({
  label = "불러오는 중…",
  lines = 3,
  variant = "lines",
}: {
  /** 화면 읽기 프로그램이 읽는 문구. */
  label?: string;
  lines?: number;
  /** "lines": 글 몇 줄. "card": 카드 하나. "inline": 한 줄짜리 짧은 막대. */
  variant?: "lines" | "card" | "inline";
}) {
  return (
    <div className={`${styles.wrap} ${styles[variant]}`} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {variant === "inline" ? (
        <span className={styles.bar} aria-hidden="true" />
      ) : (
        Array.from({ length: variant === "card" ? 3 : lines }, (_, index) => (
          <span
            key={index}
            className={styles.bar}
            aria-hidden="true"
            style={{ width: `${index === 0 ? 55 : 100 - index * 12}%` }}
          />
        ))
      )}
    </div>
  );
}
