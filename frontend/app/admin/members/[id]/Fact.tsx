/**
 * 회원 상세의 사실 한 칸 — 이름표와 값.
 *
 * 회원 상세와 그 안의 탈퇴 영역이 함께 씁니다.
 */

import styles from "../../admin.module.css";

export default function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={mono ? `${styles.factValue} numeric` : styles.factValue}>{value}</span>
    </div>
  );
}
