"use client";

/**
 * 작업이 끝난 뒤 보여 주는 한 줄.
 *
 * 성공했는지 실패했는지를 말하지 않으면, 아무 일도 일어나지 않은 화면과
 * 조용히 성공한 화면이 똑같이 보입니다.
 *
 * `role="status"`는 화면 낭독기가 초점을 옮기지 않고 읽어 주게 합니다.
 * 실패는 `role="alert"`로 더 급하게 알립니다.
 */

import styles from "../admin.module.css";

export interface Result {
  kind: "ok" | "error";
  text: string;
}

export default function ResultMessage({
  result,
  onDismiss,
}: {
  result: Result | null;
  onDismiss?: () => void;
}) {
  if (result === null) return null;

  return (
    <p
      className={`${styles.result} ${
        result.kind === "error" ? styles.resultError : styles.resultOk
      }`}
      role={result.kind === "error" ? "alert" : "status"}
    >
      <span>{result.text}</span>
      {onDismiss && (
        <button className={styles.resultClose} type="button" onClick={onDismiss}>
          <span className="sr-only">닫기</span>✕
        </button>
      )}
    </p>
  );
}
