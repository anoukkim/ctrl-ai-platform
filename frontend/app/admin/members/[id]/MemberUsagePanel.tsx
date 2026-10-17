"use client";

/**
 * 회원 상세 › 사용 내역 (admin-consolidation v3, owner 2026-10-17).
 *
 * 보고 있는 분기의: 사용 · 사용률 · 남음 · 호출 수 · 소진 예상(지금 속도면
 * 언제 지갑이 비는지), 기능별(채팅 · 빌더 · 앱 AI · 영상), 모델별(토큰과 원),
 * 최근 호출 열 개. 동아리가 부담한 호출(게시 요약 등)은 회원 것이 아니라
 * 넣지 않아요.
 */

import { useEffect, useState } from "react";

import { formatWhen } from "@/lib/admin";
import { getMemberUsage, type MemberUsage } from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { formatDate, formatKrw } from "@/lib/quarters";

import { useAdminQuarter } from "../../AdminQuarterProvider";
import StatCards from "../../components/StatCards";

import styles from "../../admin.module.css";

const TOKENS = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });

export default function MemberUsagePanel({ userId }: { userId: number }) {
  const { selected } = useAdminQuarter();
  const [loaded, setLoaded] = useState<{ key: string; usage: MemberUsage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${userId}:${selected?.id}`;
  const usage = loaded?.key === key ? loaded.usage : null;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getMemberUsage(userId, selected.id)
      .then((value) => {
        if (!cancelled) setLoaded({ key: `${userId}:${selected.id}`, usage: value });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, selected]);

  return (
    <section aria-labelledby="member-usage" data-testid="member-usage">
      <h2 className="section-title" id="member-usage">
        사용 내역
        {selected && <span className={styles.sectionNote}>{selected.display_name}</span>}
      </h2>
      {error !== null ? (
        <div className="card">
          <p className="small muted">사용 내역을 불러오지 못했습니다. {error}.</p>
        </div>
      ) : usage === null ? (
        <p className="small muted">불러오는 중…</p>
      ) : (
        <>
          <StatCards
            cards={[
              { key: "used", label: "사용", value: formatKrw(usage.used_krw) },
              { key: "pct", label: "사용률", value: usage.used_pct === null ? "—" : `${usage.used_pct}%`, accent: (usage.used_pct ?? 0) >= 80 },
              { key: "left", label: "남음", value: formatKrw(usage.remaining_krw) },
              { key: "calls", label: "호출", value: usage.calls, unit: "번" },
              { key: "runs-out", label: "소진 예상", value: usage.runs_out_on ? formatDate(usage.runs_out_on) : "—" },
            ]}
          />
          <div className={styles.analysisGrid}>
            <section className="card">
              <h3 className="section-title">기능별</h3>
              {usage.by_feature.length === 0 ? (
                <p className="small muted">아직 쓴 곳이 없어요.</p>
              ) : (
                <ul className={styles.analysisList}>
                  {usage.by_feature.map((share) => (
                    <li key={share.label}>
                      <span>{share.label}</span>
                      <span className="numeric">{formatKrw(share.krw)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <h3 className="section-title">모델별</h3>
              {usage.by_model.length === 0 ? (
                <p className="small muted">아직 쓴 모델이 없어요.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">모델</th>
                      <th scope="col">토큰</th>
                      <th scope="col">원</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.by_model.map((line) => (
                      <tr key={line.model_id}>
                        <td>{line.label}</td>
                        <td className="numeric">{TOKENS.format(line.input_tokens + line.output_tokens)}</td>
                        <td className="numeric">{formatKrw(line.krw)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
          {usage.recent.length > 0 && (
            <section className="card">
              <h3 className="section-title">최근 호출</h3>
              <ul className={styles.analysisList}>
                {usage.recent.map((call, index) => (
                  <li key={index}>
                    <span>
                      {call.place}
                      {call.model && <span className="small dim"> · {call.model}</span>}
                      <span className="small dim"> · {formatWhen(call.when)}</span>
                    </span>
                    <span className="numeric">{formatKrw(call.krw)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
