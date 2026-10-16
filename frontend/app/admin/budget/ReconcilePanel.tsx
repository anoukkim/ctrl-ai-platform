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

import AdminTable from "../components/AdminTable";

import styles from "../admin.module.css";

function utcDay(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export default function ReconcilePanel({ reportProvider }: { reportProvider: string }) {
  const [start, setStart] = useState(utcDay(-6));
  const [end, setEnd] = useState(utcDay(0));
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
    <>
      <div className="card" style={{ display: "grid", gap: "0.7rem" }}>
        {reportProvider === "mock" ? (
          <p className="small muted" data-testid="reconcile-mock">
            지금은 목업입니다 — 진짜 Anthropic 보고서 대신 우리 장부를 그대로 돌려주므로 늘
            일치로 보입니다. 진짜로 대조하려면 서버 .env에 Anthropic Admin API 키를 넣으세요
            (docs/api-distribution.md › &ldquo;비용 확인하는 법&rdquo;).
          </p>
        ) : (
          <p className="small muted">
            Anthropic의 비용 보고서는 조직 전체입니다 — 같은 계정에서 Workbench나 다른
            프로젝트가 쓴 금액도 들어가므로 Anthropic 쪽이 조금 클 수 있습니다. 보고서는 몇 분
            늦게 반영될 수 있습니다.
          </p>
        )}
        <div className={styles.formGrid}>
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>시작 (UTC)</span>
            <input className="field" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>끝 (UTC)</span>
            <input className="field" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className={styles.actionRow}>
          <button className="btn btn-sm" type="button" disabled={busy} onClick={run}>
            {busy ? "대조하는 중…" : "대조하기"}
          </button>
        </div>
        {error !== null && (
          <p className="small" role="alert" style={{ color: "var(--error-text)" }}>
            {error}
          </p>
        )}
        {result !== null && (
          <>
            <p className="small" data-testid="reconcile-summary">
              우리 장부 {formatUsd(result.ours_usd)} · Anthropic {formatUsd(result.anthropic_usd)} —{" "}
              {mismatches === 0 ? "모든 날이 일치합니다." : `${mismatches}일이 다릅니다.`}
            </p>
            <AdminTable
              columns={[
                { key: "day", header: "날짜 (UTC)", render: (row) => row.day.replaceAll("-", ".") },
                { key: "ours", header: "우리 장부", numeric: true, render: (row) => formatUsd(row.ours_usd) },
                {
                  key: "theirs",
                  header: "Anthropic",
                  numeric: true,
                  render: (row) => formatUsd(row.anthropic_usd),
                },
                {
                  key: "diff",
                  header: "차이",
                  numeric: true,
                  render: (row) => formatUsd(row.difference_usd),
                },
                {
                  key: "match",
                  header: "",
                  render: (row) => (
                    <span className={`badge ${row.matches ? "badge-ok" : "badge-warn"}`}>
                      {row.matches ? "일치" : "다름"}
                    </span>
                  ),
                },
              ]}
              rows={result.days}
              rowKey={(row) => row.day}
              empty="대조할 날이 없습니다."
              caption="날짜별 대조"
            />
          </>
        )}
      </div>
    </>
  );
}
