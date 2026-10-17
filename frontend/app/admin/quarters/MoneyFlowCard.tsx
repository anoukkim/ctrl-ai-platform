"use client";

/**
 * 돈의 흐름 (admin-consolidation v3, owner 2026-10-17) — "산 돈이 어디로
 * 나뉘었나". 산 크레딧 전체를 막대 하나로: 회원이 쓴 돈 · 회원에게 줬지만
 * 안 쓴 돈 · 여유분(나눠 주지 않은 돈). 원 기준(장부의 단위)이고, 실제
 * 원가(달러)는 사용 분석 탭에 있어요.
 */

import { useEffect, useState } from "react";

import { getMoneyFlow, type MoneyFlow } from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { formatKrw, type Quarter } from "@/lib/quarters";

import styles from "../admin.module.css";

export function flowShares(flow: MoneyFlow): { used: number; unused: number; reserve: number } {
  const whole = Math.max(flow.purchased_krw, flow.granted_krw, 1);
  const pct = (value: number) => Math.max(0, Math.round((value * 100) / whole));
  return { used: pct(flow.used_krw), unused: pct(flow.unused_krw), reserve: pct(Math.max(0, flow.reserve_krw)) };
}

export default function MoneyFlowCard({ quarter }: { quarter: Quarter }) {
  const [loaded, setLoaded] = useState<{ id: number; flow: MoneyFlow } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flow = loaded?.id === quarter.id ? loaded.flow : null;

  useEffect(() => {
    let cancelled = false;
    getMoneyFlow(quarter.id)
      .then((value) => {
        if (!cancelled) setLoaded({ id: quarter.id, flow: value });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [quarter.id]);

  return (
    <section className="card" aria-labelledby="money-flow-title" data-testid="money-flow">
      <h2 className="section-title" id="money-flow-title">
        돈의 흐름
        <span className={styles.sectionNote}>{quarter.display_name} · 원 기준</span>
      </h2>
      {error !== null && <p className="small muted">돈의 흐름을 불러오지 못했습니다. {error}.</p>}
      {error === null && flow === null && <p className="small muted">불러오는 중…</p>}
      {flow && (
        <>
          <div className={styles.flowHead}>
            <span>
              <strong>이 분기에 산 크레딧</strong> <span className="small dim">제공자에서 구매 · 크레딧은 분기를 넘어 남아요</span>
            </span>
            <strong className="numeric">{formatKrw(flow.purchased_krw)}</strong>
          </div>
          <FlowBar flow={flow} />
          <dl className={styles.flowLegend}>
            <div>
              <dt>
                <span className={styles.flowSwatch} data-part="used" aria-hidden="true" /> 회원이 쓴 돈
              </dt>
              <dd className="numeric">
                {formatKrw(flow.used_krw)}
                {flow.granted_krw > 0 && <span className="small dim"> · 지급의 {Math.round((flow.used_krw * 100) / flow.granted_krw)}%</span>}
              </dd>
            </div>
            <div>
              <dt>
                <span className={styles.flowSwatch} data-part="unused" aria-hidden="true" /> 회원에게 줬지만 아직 안 쓴 돈
              </dt>
              <dd className="numeric">
                {formatKrw(flow.unused_krw)} <span className="small dim">· {flow.members}명 지갑</span>
              </dd>
            </div>
            <div>
              <dt>
                <span className={styles.flowSwatch} data-part="reserve" aria-hidden="true" /> 여유분 · 나눠 주지 않은 돈
              </dt>
              <dd className="numeric">
                {flow.reserve_krw >= 0 ? (
                  <>
                    {formatKrw(flow.reserve_krw)}
                    <span className="small dim"> · 유지보수 · 테스트 · 추가 지급</span>
                  </>
                ) : (
                  <span className="small dim">
                    이 분기 구매보다 {formatKrw(-flow.reserve_krw)} 더 나눠 줬어요 — 이전에 산 크레딧으로 충당
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <p className="small muted" style={{ margin: 0 }}>
            회원에게 준 몫 {formatKrw(flow.granted_krw)}(이월 · 조정 포함) · 동아리가 부담한 호출(게시 요약, 이름 짓기, 빌더
            점검 등) {formatKrw(flow.reserve_spent_krw)}
            {flow.forecast_used_krw !== null && flow.granted_krw > 0 && (
              <>
                {" "}
                · 분기 말 예상 회원 사용 {formatKrw(flow.forecast_used_krw)} (지급의{" "}
                {Math.round((flow.forecast_used_krw * 100) / flow.granted_krw)}%)
              </>
            )}
          </p>
          <p className="small dim" style={{ margin: 0 }}>
            실제 원가(제공자 청구, 달러)와 회원 지갑에서 빠진 돈은 따로 기록돼요 — 원가는 「사용 분석」 탭.
          </p>
        </>
      )}
    </section>
  );
}

function FlowBar({ flow }: { flow: MoneyFlow }) {
  const shares = flowShares(flow);
  return (
    <div
      className={styles.flowBar}
      role="img"
      aria-label={`회원이 쓴 돈 ${shares.used}%, 안 쓴 돈 ${shares.unused}%, 여유분 ${shares.reserve}%`}
    >
      <span data-part="used" style={{ width: `${shares.used}%` }} />
      <span data-part="unused" style={{ width: `${shares.unused}%` }} />
      <span data-part="reserve" style={{ width: `${shares.reserve}%` }} />
    </div>
  );
}
