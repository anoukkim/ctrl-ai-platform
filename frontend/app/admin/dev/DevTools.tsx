"use client";

/**
 * Admin — 개발 도구 (/admin/dev). 개발 환경에서만 보입니다.
 *
 * 제공자를 붙이기 전에 Usage 화면과 감사 로그가 실제로 움직이는지 확인
 * 하려면 예산이 한 번 줄어들어야 합니다. 이 화면은 그 일을 합니다 —
 * Claude도 Higgsfield도 부르지 않고, 실제 차감 코드(`charge()`)만
 * 지나갑니다. 자기 원장 줄을 따로 쓰는 지름길이면 아무것도 증명하지
 * 못합니다.
 *
 * 배포 환경에서는 백엔드가 404를 돌려줍니다 — 403이 아닙니다. 없는 길과
 * 구분되지 않아야 하기 때문입니다. 사이드바와 탭에서 이 구역이 사라지는
 * 것은 편의일 뿐이고, 실제 차단은 백엔드가 합니다.
 */

import { useState } from "react";

import { describeError } from "@/lib/http";
import { formatKrw, simulateUsage } from "@/lib/quarters";

import { useAdminQuarter } from "../AdminQuarterProvider";
import ResultMessage, { type Result } from "../components/ResultMessage";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

export default function DevTools() {
  const { dashboard, refresh } = useAdminQuarter();

  const [amount, setAmount] = useState("5000");
  const [category, setCategory] = useState<"build" | "video">("build");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // 백엔드가 개발 환경이 아니라고 말하면 도구를 그리지 않습니다.
  if (dashboard !== null && !dashboard.is_development) {
    return (
      <div className={styles.sections}>
        <PageHeader />
        <div className="card">
          <p className="small muted">
            Dev Tools는 개발 환경에서만 쓸 수 있습니다. 이 환경에서는 백엔드가 요청을
            받지 않습니다.
          </p>
        </div>
      </div>
    );
  }

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const event = await simulateUsage({
        category,
        amount_krw: Number(amount.replaceAll(",", "")) || 0,
        provider: category === "build" ? "claude" : "higgsfield",
      });
      setResult({
        kind: "ok",
        text: `${formatKrw(event.charged_krw)}을 차감했습니다. Usage 화면과 Audit Log가 함께 바뀝니다.`,
      });
      await refresh();
    } catch (caught) {
      setResult({ kind: "error", text: describeError(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.sections}>
      <PageHeader />

      <section aria-labelledby="dev-simulate">
        <h2 className="section-title" id="dev-simulate">
          사용량 시뮬레이션
          <span className={styles.sectionNote}>개발 환경 전용</span>
        </h2>

        <ResultMessage result={result} onDismiss={() => setResult(null)} />

        <div className="card">
          <p className="small muted" style={{ marginBottom: "0.7rem" }}>
            제공자를 부르지 않고 내 예산에서 금액을 차감합니다. 실제 차감 코드를 그대로
            지나가므로 Usage 화면과 Audit Log가 함께 바뀝니다.
          </p>
          <div className={styles.simulateRow}>
            <select
              className="field"
              value={category}
              onChange={(event) => setCategory(event.target.value as "build" | "video")}
              aria-label="구분"
            >
              <option value="build">Build (Claude)</option>
              <option value="video">Video (Higgsfield)</option>
            </select>
            <input
              className="field"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label="금액 (원)"
              placeholder="5000"
            />
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => void run()}
              disabled={busy}
            >
              {busy ? "차감 중…" : "사용해 보기"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PageHeader() {
  return (
    <header className="page-header page-header-stacked">
      <h1 className="page-title">{sectionLabel("dev")}</h1>
      <p className="page-subtitle">
        제공자를 붙이기 전에 예산과 기록이 실제로 움직이는지 확인하는 도구입니다. 배포
        환경에서는 동작하지 않습니다.
      </p>
    </header>
  );
}
