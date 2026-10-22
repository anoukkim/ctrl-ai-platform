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
import { PanelSection, Stats } from "../../components/AdminUI";

import styles from "../members.module.css";

const TOKENS = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });

export default function MemberUsagePanel({ userId }: { userId: number }) {
  const { selected, dashboard } = useAdminQuarter();
  // 알림 기준 (Admin › System), as on the Members list.
  const warnPct = dashboard?.alert_thresholds?.wallet_pct ?? 80;
  const [loaded, setLoaded] = useState<{ key: string; usage: MemberUsage } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const key = `${userId}:${selected?.id}`;
  const usage = loaded?.key === key ? loaded.usage : null;
  const error = failed?.key === key ? failed.message : null;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getMemberUsage(userId, selected.id)
      .then((value) => {
        if (!cancelled) setLoaded({ key: `${userId}:${selected.id}`, usage: value });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setFailed({ key: `${userId}:${selected.id}`, message: describeError(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, selected]);

  return (
    <div data-testid="member-usage">
      <PanelSection
        title={
          <>
            사용 내역
            {selected && <span className={styles.sectionExtra}>{selected.display_name}</span>}
          </>
        }
      >
        {error !== null ? (
          <p className={styles.note}>사용 내역을 불러오지 못했습니다. {error}.</p>
        ) : usage === null ? (
          <p className={styles.note}>불러오는 중…</p>
        ) : (
          <>
            <Stats
              items={[
                { key: "used", label: "사용", value: formatKrw(usage.used_krw) },
                {
                  key: "pct",
                  label: "사용률",
                  value: usage.used_pct === null ? "—" : `${usage.used_pct}%`,
                  tone: (usage.used_pct ?? 0) >= warnPct ? "warn" : undefined,
                },
                { key: "left", label: "남음", value: formatKrw(usage.remaining_krw) },
                { key: "calls", label: "호출", value: `${usage.calls}번` },
                { key: "runs-out", label: "소진 예상", value: usage.runs_out_on ? formatDate(usage.runs_out_on) : "—" },
              ]}
            />
            <div className={styles.split}>
              <div className={styles.box}>
                <b>기능별</b>
                {usage.by_feature.length === 0 ? (
                  <p className={styles.note}>아직 쓴 곳이 없어요.</p>
                ) : (
                  <ul className={styles.list}>
                    {usage.by_feature.map((share) => (
                      <li key={share.label}>
                        <span>{share.label}</span>
                        <span className="numeric">{formatKrw(share.krw)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={styles.box}>
                <b>모델별</b>
                {usage.by_model.length === 0 ? (
                  <p className={styles.note}>아직 쓴 모델이 없어요.</p>
                ) : (
                  <ul className={styles.list}>
                    {usage.by_model.map((line) => (
                      <li key={line.model_id}>
                        <span>
                          {line.label}
                          <span className={styles.dim}> · {TOKENS.format(line.input_tokens + line.output_tokens)} 토큰</span>
                        </span>
                        <span className="numeric">{formatKrw(line.krw)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {usage.recent.length > 0 && (
              <div className={styles.box}>
                <b>최근 호출</b>
                <ul className={styles.list}>
                  {usage.recent.map((call, index) => (
                    <li key={index}>
                      <span>
                        {call.place}
                        {call.model && <span className={styles.dim}> · {call.model}</span>}
                        <span className={styles.dim}> · {formatWhen(call.when)}</span>
                      </span>
                      <span className="numeric">{formatKrw(call.krw)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </PanelSection>
    </div>
  );
}
