"use client";

/**
 * 돈의 흐름 (admin-consolidation v3, owner 2026-10-17) — "산 돈이 어디로
 * 나뉘었나". 산 크레딧 전체를 막대 하나로: 회원이 쓴 돈 · 회원에게 줬지만
 * 안 쓴 돈 · 여유분(나눠 주지 않은 돈). 원 기준(장부의 단위)이고, 실제
 * 원가(달러)는 사용 분석 탭에 있어요. 위는 숫자 카드(`Stats`), 아래는 막대.
 */

import { useEffect, useState } from "react";

import { getMoneyFlow, type MoneyFlow } from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { formatKrw, type Quarter } from "@/lib/quarters";

import { SettingsCard, Stack, Stats } from "../components/AdminUI";

import styles from "./quarters.module.css";

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

  const pctOfGranted = (value: number) => (flow && flow.granted_krw > 0 ? Math.round((value * 100) / flow.granted_krw) : null);
  const usedPct = flow ? pctOfGranted(flow.used_krw) : null;
  const forecastPct = flow && flow.forecast_used_krw !== null ? pctOfGranted(flow.forecast_used_krw) : null;

  return (
    <div data-testid="money-flow">
      <Stack>
        {flow && (
          <Stats
            items={[
              { key: "bought", value: formatKrw(flow.purchased_krw), label: "이 분기에 산 크레딧" },
              {
                key: "used",
                value: formatKrw(flow.used_krw),
                label: usedPct === null ? "회원이 쓴 돈" : `회원이 쓴 돈 · 지급의 ${usedPct}%`,
                tone: "accent",
              },
              { key: "unused", value: formatKrw(flow.unused_krw), label: `줬지만 안 쓴 돈 · ${flow.members}명 지갑` },
              {
                key: "reserve",
                value: formatKrw(flow.reserve_krw),
                label: flow.reserve_krw >= 0 ? "여유분 · 나눠 주지 않은 돈" : "여유분 · 이전 크레딧으로 충당",
                tone: flow.reserve_krw < 0 ? "warn" : undefined,
              },
            ]}
          />
        )}
        <SettingsCard title="돈의 흐름" extra={`${quarter.display_name} · 원 기준`} wide>
          {error !== null && <p className={styles.foot}>돈의 흐름을 불러오지 못했습니다. {error}.</p>}
          {error === null && flow === null && <p className={styles.foot}>불러오는 중…</p>}
          {flow && (
            <>
              <FlowBar flow={flow} />
              <ul className={styles.legend}>
                <li>
                  <span className={styles.swatch} data-part="used" aria-hidden="true" /> 회원이 쓴 돈
                </li>
                <li>
                  <span className={styles.swatch} data-part="unused" aria-hidden="true" /> 줬지만 아직 안 쓴 돈
                </li>
                <li>
                  <span className={styles.swatch} data-part="reserve" aria-hidden="true" /> 여유분 · 유지보수 · 테스트 · 추가
                  지급
                </li>
              </ul>
              <p className={styles.foot}>
                {flow.reserve_krw < 0 && (
                  <>이 분기 구매보다 {formatKrw(-flow.reserve_krw)} 더 나눠 줬어요 — 이전에 산 크레딧으로 충당 · </>
                )}
                회원에게 준 몫 {formatKrw(flow.granted_krw)}(이월 · 조정 포함) · 동아리가 부담한 호출(게시 요약, 이름
                짓기, 빌더 점검 등) {formatKrw(flow.reserve_spent_krw)}
                {flow.forecast_used_krw !== null && forecastPct !== null && (
                  <>
                    {" "}
                    · 분기 말 예상 회원 사용 {formatKrw(flow.forecast_used_krw)} (지급의 {forecastPct}%)
                  </>
                )}
              </p>
            </>
          )}
        </SettingsCard>
      </Stack>
    </div>
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
