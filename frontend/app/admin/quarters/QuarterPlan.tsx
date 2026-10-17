"use client";

/**
 * Quarters › 분기 · 예산 (admin-consolidation v3) — "산 돈이 어디로
 * 나뉘었나": 돈의 흐름, 분기 마감 다섯 단계, 그리고 분기 목록과 새 분기.
 */

import { useState } from "react";

import { useAdminQuarter } from "../AdminQuarterProvider";
import ResultMessage, { type Result } from "../components/ResultMessage";
import CloseStepper from "./CloseStepper";
import MoneyFlowCard from "./MoneyFlowCard";
import QuarterAdmin from "./QuarterAdmin";

import styles from "../admin.module.css";

export default function QuarterPlan() {
  const { quarters, selected, refresh } = useAdminQuarter();
  const [result, setResult] = useState<Result | null>(null);
  // After a step, the quarter list below reads itself again.
  const [version, setVersion] = useState(0);

  return (
    <div className={styles.sections}>
      <QuarterAdmin key={version} />
      <ResultMessage result={result} onDismiss={() => setResult(null)} />
      {selected && <MoneyFlowCard key={`flow-${selected.id}-${version}`} quarter={selected} />}
      {selected && quarters && (
        <CloseStepper
          key={`steps-${selected.id}-${version}`}
          quarter={selected}
          quarters={quarters}
          onChanged={(message) => {
            setResult({ kind: "ok", text: message });
            void refresh().then(() => setVersion((value) => value + 1));
          }}
        />
      )}
    </div>
  );
}
