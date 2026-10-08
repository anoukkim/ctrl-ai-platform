"use client";

/**
 * 버튼 옆 예상 비용 아래에 붙는 한 줄: 하나뿐인 지원금과 비교한 결과.
 *
 * 채팅이든 영상이든 같은 지갑에서 나가므로(single-wallet) 모든 유료 버튼이
 * 이 한 줄을 씁니다. 값은 사이드바와 같은 MyQuarterProvider에서 옵니다 —
 * 화면마다 따로 부르면 서로 다른 순간의 잔액을 보여 줍니다.
 */

import { compareToWallet } from "@/lib/quarters";

import { useMyQuarter } from "./MyQuarterProvider";
import styles from "./wallet-check.module.css";

export default function WalletCheck({ costKrw }: { costKrw: number | null }) {
  const { state } = useMyQuarter();
  if (state.phase !== "ready") return null;

  const verdict = compareToWallet(costKrw, state.quarter.allocation, state.quarter.personal);
  if (verdict === null) return null;

  return (
    <span className={`${styles.check} ${styles[verdict.tone]}`} data-testid="wallet-check">
      {verdict.text}
    </span>
  );
}
