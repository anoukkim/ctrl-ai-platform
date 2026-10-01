"use client";

/**
 * Usage — 이번 분기에 쓴 돈과 남은 돈.
 *
 * 모든 숫자가 백엔드에서 옵니다. 목업은 더 이상 없습니다.
 *
 * 화면이 답해야 하는 질문은 하나입니다: "지금 얼마 남았나?" 그래서 카드마다
 * 큰 숫자는 남은 금액 하나뿐이고, 지원금과 사용액은 그 아래 한 줄로만
 * 보조합니다. 같은 숫자를 세 줄로 다시 늘어놓으면 눈이 어디를 봐야 할지
 * 알 수 없게 됩니다.
 *
 * 동아리 지원과 개인 잔액은 끝까지 분리합니다. 합치면 회원이 "지원을 더
 * 받았다"고 오해합니다.
 */

import { useEffect, useState } from "react";

import {
  FUNDING_LABEL,
  MEMBERSHIP_BADGE,
  MEMBERSHIP_LABEL,
  NOT_PARTICIPATING_HINT,
  formatKrw,
  getMyUsage,
  providerName,
  type MyUsage,
} from "@/lib/quarters";
import { describeError } from "@/lib/http";

import styles from "./usage.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; usage: MyUsage }
  | { phase: "error"; message: string };

/** 2026-10-01T05:12:00Z → 2026.10.01 */
function formatDay(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", ".");
}

export default function UsageView() {
  const [state, setState] = useState<State>({ phase: "loading" });

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    getMyUsage()
      .then((usage) => {
        if (!cancelled) setState({ phase: "ready", usage });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") {
    return <p className="small muted">불러오는 중…</p>;
  }

  if (state.phase === "error") {
    return (
      <div className="card">
        <p className="small muted">사용량을 불러오지 못했습니다. {state.message}.</p>
      </div>
    );
  }

  const usage = state.usage;
  const status = usage.membership_status ?? "inactive";
  const personal = usage.personal;

  return (
    <>
      {/* 분기 막대 */}
      {usage.quarter_name && (
        <div className={styles.seasonBar}>
          <div>
            <p className={styles.seasonName}>{usage.quarter_name}</p>
            {usage.quarter_code && <p className={styles.seasonRange}>{usage.quarter_code}</p>}
          </div>
          <span className={`badge ${MEMBERSHIP_BADGE[status]}`}>{MEMBERSHIP_LABEL[status]}</span>
          <span className={styles.seasonSpacer} />
          {usage.days_remaining !== null && (
            <span className={styles.seasonDday}>
              <span>분기 종료까지</span>
              <span>
                <span className={styles.seasonDdayValue}>{usage.days_remaining}</span>일
              </span>
            </span>
          )}
        </div>
      )}

      {status !== "active" && <p className="notice">{NOT_PARTICIPATING_HINT}</p>}

      {/* 동아리 지원 */}
      <h2 className="section-title">
        동아리 지원
        {usage.total_budget_krw > 0 && (
          <span className={styles.sectionNote}>
            이번 분기 지원 {formatKrw(usage.total_budget_krw)}
          </span>
        )}
      </h2>

      {usage.categories.length === 0 ? (
        <div className="card" style={{ marginBottom: "1.6rem" }}>
          <p className="small muted">
            아직 승인된 지원금이 없습니다. Profile에서 이번 분기 참여를 신청할 수 있습니다.
          </p>
        </div>
      ) : (
        <div className={styles.allocations}>
          {usage.categories.map((item, index) => {
            const percent =
              item.budget_krw > 0
                ? Math.min(100, Math.round((item.consumed_krw / item.budget_krw) * 100))
                : 0;

            return (
              <section className={styles.card} key={item.category}>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>
                    {item.category === "build" ? "Build" : "Video"}
                  </span>
                  <span className={styles.provider}>{item.provider}</span>
                </div>

                {/* 이 화면에서 가장 큰 숫자. 찾는 답은 이것 하나입니다. */}
                <p className={styles.remaining}>
                  <span className={styles.remainingValue}>{formatKrw(item.remaining_krw)}</span>
                  <span className={styles.remainingLabel}>남음</span>
                </p>

                {/* 막대가 비율을 보여 주므로 "% 사용" 배지는 두지 않습니다.
                    대신 화면 낭독기를 위해 같은 내용을 이름으로 남깁니다. */}
                <div
                  className="meter"
                  role="img"
                  aria-label={`${item.category === "build" ? "Build" : "Video"} 지원금 중 ${percent}% 사용`}
                >
                  <div
                    className={`meter-fill ${index === 1 ? "meter-fill-blue" : ""}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                {/* 큰 숫자를 뒷받침하는 한 줄. 같은 값을 목록으로 반복하지 않습니다. */}
                <p className={styles.cardFoot}>
                  <span>
                    사용 <span className={styles.footNumber}>{formatKrw(item.consumed_krw)}</span>
                  </span>
                  <span>
                    지원 <span className={styles.footNumber}>{formatKrw(item.budget_krw)}</span>
                  </span>
                </p>

                <p className={styles.cardNote}>
                  {item.category === "build"
                    ? "Chat과 Project Builder에서 Claude를 쓸 때 차감됩니다."
                    : "Higgsfield로 영상을 만들 때 차감됩니다."}
                </p>
              </section>
            );
          })}
        </div>
      )}

      {/* 개인 잔액 — 지원금과 섞이지 않도록 따로 둡니다. */}
      <h2 className="section-title">
        개인 잔액
        <span className={styles.sectionNote}>동아리 지원과 별도입니다</span>
      </h2>

      {personal && (
        <section className={`card ${styles.personal}`}>
          <div className={styles.personalGrid}>
            <div className={styles.personalItem}>
              <span className={styles.personalLabel}>충전 잔액</span>
              <span className={styles.personalValue}>{formatKrw(personal.balance_krw)}</span>
            </div>
            <div className={styles.personalItem}>
              <span className={styles.personalLabel}>개인 사용</span>
              <span className={styles.personalValue}>{formatKrw(personal.consumed_krw)}</span>
            </div>
            <div className={styles.personalItem}>
              <span className={styles.personalLabel}>남은 개인 잔액</span>
              <span className={`${styles.personalValue} ${styles.personalValueAccent}`}>
                {formatKrw(personal.remaining_krw)}
              </span>
            </div>
          </div>

          <p className={styles.personalNote}>
            개인 충전금은 분기 지원 한도에 포함되지 않습니다.{" "}
            {personal.overage_enabled
              ? "지원금을 다 쓰면 개인 잔액에서 차감됩니다."
              : "개인 사용이 꺼져 있어, 지원금을 다 쓰면 사용이 멈춥니다."}
          </p>
        </section>
      )}

      {/* 최근 사용 내역 */}
      <h2 className="section-title">최근 사용 내역</h2>

      {usage.events.length === 0 ? (
        <div className="card">
          <p className={styles.ledgerEmpty}>
            아직 사용 내역이 없습니다. Project Builder나 Video Generator에서 무언가를 만들면
            여기에 쌓입니다.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">구분</th>
                <th scope="col">사용한 곳</th>
                <th scope="col">제공자</th>
                <th scope="col">금액</th>
                <th scope="col">차감</th>
              </tr>
            </thead>
            <tbody>
              {usage.events.map((event) => (
                <tr key={event.id}>
                  <td className={styles.when}>{formatDay(event.created_at)}</td>
                  <td>
                    <span className="badge badge-muted">
                      {event.category === "build" ? "Build" : "Video"}
                    </span>
                  </td>
                  <td>{event.label}</td>
                  <td>{providerName(event.provider)}</td>
                  <td className={styles.amount}>{formatKrw(event.charged_krw)}</td>
                  <td>
                    <span
                      className={`badge ${
                        event.funding_source === "personal" ? "badge-warn" : "badge-ok"
                      }`}
                    >
                      {FUNDING_LABEL[event.funding_source]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
