"use client";

/**
 * Quarters › 사용 분석 (admin-consolidation v3, owner 2026-10-17) — "어디에 썼나".
 *
 * 원가(제공자가 청구한 달러와 그 원화)와 청구(회원 지갑에서 빠진 원)를 나란히:
 * 제공자별(남은 크레딧, 지금 속도면 언제 다 쓰는지 — 다음에 무엇을 살지),
 * 캐시로 아낀 돈, 기능별, 모델별, 앱 TOP 5, 회원 TOP 5, 지난 30일 추이와 분기
 * 말 예상. 크레딧 구매 기록과 대조, CSV(Concur 포함)는 그 아래 접는 칸에.
 */

import { useCallback, useEffect, useState } from "react";

import PageHeader from "@/app/components/PageHeader";
import Skeleton from "@/app/components/Skeleton";
import {
  concurCsvUrl,
  exportUrl,
  formatUsd,
  getCredit,
  getUsageAnalysis,
  type CreditOverview,
  type QuarterAnalysis,
} from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { formatDate, formatKrw } from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import CachePanel from "../budget/CachePanel";
import CreditPanel from "../budget/CreditPanel";
import ReconcilePanel from "../budget/ReconcilePanel";
import Fold, { FoldGroup } from "../components/Fold";
import StatCards from "../components/StatCards";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

export default function UsageAnalysis() {
  const { selected } = useAdminQuarter();
  const [loaded, setLoaded] = useState<{ id: number; analysis: QuarterAnalysis } | null>(null);
  const [credit, setCredit] = useState<CreditOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analysis = selected && loaded?.id === selected.id ? loaded.analysis : null;

  const reloadCredit = useCallback(async () => {
    setCredit(await getCredit(selected?.id ?? null));
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    Promise.all([getUsageAnalysis(selected.id), getCredit(selected.id)])
      .then(([value, overview]) => {
        if (cancelled) return;
        setLoaded({ id: selected.id, analysis: value });
        setCredit(overview);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const header = (
    <PageHeader
      eyebrow="Admin"
      title={sectionLabel("budget")}
      subtitle="사용 분석 — 어디에 썼나. 원가(제공자 청구)와 청구(회원 지갑)는 따로 기록돼서 나란히 보여요."
    />
  );
  if (!selected) return header;
  if (error) {
    return (
      <>
        {header}
        <div className="card">
          <p className="small muted">사용 분석을 불러오지 못했습니다. {error}.</p>
        </div>
      </>
    );
  }
  if (!analysis) {
    return (
      <>
        {header}
        <Skeleton />
      </>
    );
  }

  return (
    <div className={styles.sections} data-testid="usage-analysis">
      {header}
      <StatCards
        cards={[
          { key: "cost", label: `이번 분기 원가 (${formatUsd(analysis.cost_usd)})`, value: formatKrw(analysis.cost_krw) },
          { key: "charged", label: "회원에게 청구된 금액", value: formatKrw(analysis.charged_krw) },
          { key: "saved", label: "캐시로 아낀 돈", value: formatKrw(analysis.cache_saved_krw) },
          {
            key: "runs-out",
            label: "크레딧 소진 예상",
            value: analysis.runs_out_on ? formatDate(analysis.runs_out_on) : "—",
          },
        ]}
      />

      <section className="card" aria-labelledby="usage-providers">
        <h2 className="section-title" id="usage-providers">
          제공자별 원가와 청구를 나란히
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">제공자</th>
                <th scope="col">원가</th>
                <th scope="col">청구</th>
                <th scope="col">남은 크레딧</th>
                <th scope="col">소진 예상</th>
              </tr>
            </thead>
            <tbody>
              {analysis.providers.map((line) => (
                <tr key={line.provider}>
                  <td>{line.label}</td>
                  <td className="numeric">{formatUsd(line.cost_usd)}</td>
                  <td className="numeric">{formatKrw(line.charged_krw)}</td>
                  <td className="numeric">{line.remaining_usd === null ? "구매 기록 없음" : formatUsd(line.remaining_usd)}</td>
                  <td className="numeric">{line.runs_out_on ? formatDate(line.runs_out_on) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.analysisGrid}>
        <ShareCard title="기능별" shares={analysis.by_feature} />
        <section className="card" aria-labelledby="usage-models">
          <h2 className="section-title" id="usage-models">
            모델별
          </h2>
          {analysis.by_model.length === 0 ? (
            <p className="small muted">아직 쓴 모델이 없어요.</p>
          ) : (
            <ul className={styles.analysisList}>
              {analysis.by_model.map((line) => (
                <li key={line.model_id}>
                  <span>{line.label}</span>
                  <span className="numeric">{formatKrw(line.krw)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <TopCard title="앱 TOP 5" lines={analysis.top_apps} href={(id) => `/admin/apps/${id}`} quarterId={selected.id} />
        <TopCard title="회원 TOP 5" lines={analysis.top_members} href={(id) => `/admin/members?member=${id}`} quarterId={selected.id} />
      </div>

      <section className="card" aria-labelledby="usage-trend">
        <h2 className="section-title" id="usage-trend">
          일별 추이
          <span className={styles.sectionNote}>
            지난 30일 · 청구 원
            {analysis.forecast_krw !== null && ` · 분기 말 예상 ${formatKrw(analysis.forecast_krw)}`}
          </span>
        </h2>
        <TrendChart days={analysis.daily} />
      </section>

      <FoldGroup screen="usage-analysis">
        {credit && (
          <Fold id="credit" title="크레딧 구매 기록" note="제공자별 · 남은 크레딧은 추정, 제공자 콘솔이 최종 기준">
            <CreditPanel credit={credit} onChanged={reloadCredit} />
          </Fold>
        )}
        <Fold id="cache" title="캐시" note="모델별 · 날짜별(KST) · 채팅 답장만">
          <CachePanel />
        </Fold>
        {credit && (
          <Fold id="reconcile" title="대조" note="우리 기록과 Anthropic 비용 보고서">
            <ReconcilePanel reportProvider={credit.report_provider} />
          </Fold>
        )}
        <Fold id="export" title="내보내기 (CSV)" note="Excel에서 한글이 깨지지 않게 저장돼요">
          <div className={styles.rowButtons}>
            <a className="btn btn-sm btn-primary" href={concurCsvUrl(selected.id)} download>
              ⤓ Concur (이 분기 크레딧 구매)
            </a>
            <a className="btn btn-sm" href={exportUrl.members(selected.id)} download>
              회원별
            </a>
            <a className="btn btn-sm" href={exportUrl.daily(selected.id)} download>
              날짜별
            </a>
            <a className="btn btn-sm" href={exportUrl.purchases()} download>
              구매 기록 전체
            </a>
          </div>
        </Fold>
      </FoldGroup>
      <p className="small dim">
        회원 한 명의 사용 내역은 Members에서 그 회원을 열면 있어요 —{" "}
        <a href={withQuarter("/admin/members", selected.id)}>Members</a>.
      </p>
    </div>
  );
}

function ShareCard({ title, shares }: { title: string; shares: QuarterAnalysis["by_feature"] }) {
  return (
    <section className="card">
      <h2 className="section-title">{title}</h2>
      {shares.length === 0 ? (
        <p className="small muted">아직 쓴 곳이 없어요.</p>
      ) : (
        <ul className={styles.analysisList}>
          {shares.map((share) => (
            <li key={share.label}>
              <span>{share.label}</span>
              <span className="numeric">
                {formatKrw(share.krw)} · {share.pct}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopCard({
  title,
  lines,
  href,
  quarterId,
}: {
  title: string;
  lines: { id: number; name: string; krw: number }[];
  href: (id: number) => string;
  quarterId: number;
}) {
  return (
    <section className="card">
      <h2 className="section-title">{title}</h2>
      {lines.length === 0 ? (
        <p className="small muted">아직 없어요.</p>
      ) : (
        <ol className={styles.analysisList}>
          {lines.map((line) => (
            <li key={line.id}>
              <a href={withQuarter(href(line.id), quarterId)}>{line.name}</a>
              <span className="numeric">{formatKrw(line.krw)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The last 30 days as bars (청구 원). */
export function TrendChart({ days }: { days: { day: string; krw: number }[] }) {
  if (days.length === 0) return <p className="small muted">이 분기에는 아직 날이 없어요.</p>;
  const max = Math.max(...days.map((day) => day.krw), 1);
  const total = days.reduce((sum, day) => sum + day.krw, 0);
  return (
    <div
      className={styles.trend}
      role="img"
      aria-label={`지난 ${days.length}일 청구 ${formatKrw(total)}, 하루 가장 많을 때 ${formatKrw(max)}`}
    >
      {days.map((day) => (
        <span key={day.day} title={`${day.day} · ${formatKrw(day.krw)}`} style={{ height: `${Math.max(2, (day.krw / max) * 100)}%` }} />
      ))}
    </div>
  );
}
