/**
 * 회원 상세의 사실 칸들 — 이름표와 값 (admin-ui-unify).
 *
 * `Fact.tsx`는 앱 상세도 함께 쓰고 있어 그대로 두고, 회원 판은 이 작은
 * 버전을 씁니다(판의 좁은 폭에 맞춘 크기).
 */

import type { ReactNode } from "react";

import styles from "../members.module.css";

export function Facts({ children }: { children: ReactNode }) {
  return <div className={styles.facts}>{children}</div>;
}

export function FactItem({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={mono ? `${styles.factValue} numeric` : styles.factValue}>{value}</span>
    </div>
  );
}
