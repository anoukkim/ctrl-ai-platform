"use client";

/**
 * Anthropic 비용과 대조 (cost-clarity) — 우리 장부의 provider_cost와
 * Anthropic의 비용 보고서(Cost API)를 날짜별(UTC)로 비교합니다.
 *
 * 선택 기능입니다. 서버 .env에 Anthropic **Admin** API 키
 * (ANTHROPIC_ADMIN_API_KEY)와 ANTHROPIC_ADMIN_PROVIDER=anthropic이 있어야
 * 진짜 보고서를 읽습니다. 없으면 목업이 우리 장부를 그대로 돌려주므로 화면은
 * 늘 "일치"입니다 — 화면이 그 사실을 먼저 말합니다.
 */

import { useState } from "react";

import { formatUsd, reconcile, type Reconcile } from "@/lib/accounting";
import { describeError } from "@/lib/http";

import { DataTable, PanelBar, Pill, Stack } from "../components/AdminUI";

import styles from "../quarters/quarters.module.css";

function utcDay(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export default function ReconcilePanel({ reportProvider }: { reportProvider: string }) {
  const [start, setStart] = useState(() => utcDay(-6));
  const [end, setEnd] = useState(() => utcDay(0));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Reconcile | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await reconcile(start, end));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const mismatches = result?.days.filter((day) => !day.matches).length ?? 0;

  return (
    <Stack>
      <PanelBar
        left={
          reportProvider === "mock" ? (
            <Pill tone="warn">목업</Pill>
          ) : (
            <Pill tone="ok">Anthropic 보고서</Pill>
          )
        }
        note={
          reportProvider === "mock" ? (
            <span data-testid="reconcile-mock">지금은 목업이라 우리 장부를 그대로 돌려줘 늘 일치로 보여요</span>
          ) : (
            "우리 장부와 Anthropic 비용 보고서를 날짜별(UTC)로"
          )
        }
        help={
          reportProvider === "mock" ? (
            <p>
              진짜로 대조하려면 서버 .env에 Anthropic Admin API 키(ANTHROPIC_ADMIN_API_KEY)와
              ANTHROPIC_ADMIN_PROVIDER=anthropic을 넣으세요 (docs/api-distribution.md › &ldquo;비용 확인하는 법&rdquo;).
            </p>
          ) : (
            <p>
              Anthropic의 비용 보고서는 조직 전체예요 — 같은 계정에서 Workbench나 다른 프로젝트가 쓴 금액도 들어가므로
              Anthropic 쪽이 조금 클 수 있어요. 보고서는 몇 분 늦게 반영될 수 있어요.
            </p>
          )
        }
      />
      <div className={styles.formPair}>
        <div className={styles.formField}>
          <label htmlFor="reconcile-start">시작 (UTC)</label>
          <input id="reconcile-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className={styles.formField}>
          <label htmlFor="reconcile-end">끝 (UTC)</label>
          <input id="reconcile-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className={styles.buttons}>
        <button className="btn btn-sm" type="button" disabled={busy} onClick={run}>
          {busy ? "대조하는 중…" : "대조하기"}
        </button>
      </div>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {result !== null && (
        <>
          <p className="small" style={{ margin: 0 }} data-testid="reconcile-summary">
            우리 장부 {formatUsd(result.ours_usd)} · Anthropic {formatUsd(result.anthropic_usd)} —{" "}
            {mismatches === 0 ? "모든 날이 일치합니다." : `${mismatches}일이 다릅니다.`}
          </p>
          <DataTable testId="reconcile-table">
            <caption className="sr-only">날짜별 대조</caption>
            <thead>
              <tr>
                <th scope="col">날짜 (UTC)</th>
                <th scope="col" data-numeric="">우리 장부</th>
                <th scope="col" data-numeric="">Anthropic</th>
                <th scope="col" data-numeric="">차이</th>
                <th scope="col">
                  <span className="sr-only">일치</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {result.days.length === 0 ? (
                <tr>
                  <td colSpan={5} className="small dim">
                    대조할 날이 없어요.
                  </td>
                </tr>
              ) : (
                result.days.map((row) => (
                  <tr key={row.day}>
                    <td>{row.day.replaceAll("-", ".")}</td>
                    <td data-numeric="">{formatUsd(row.ours_usd)}</td>
                    <td data-numeric="">{formatUsd(row.anthropic_usd)}</td>
                    <td data-numeric="">{formatUsd(row.difference_usd)}</td>
                    <td>
                      <Pill tone={row.matches ? "ok" : "warn"}>{row.matches ? "일치" : "다름"}</Pill>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </>
      )}
    </Stack>
  );
}
