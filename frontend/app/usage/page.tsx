/**
 * Usage — 이번 시즌 사용량 (목업).
 *
 * Claude는 토큰으로, 영상 생성은 크레딧으로 계산합니다. 단위가 서로 다르므로
 * 하나의 가짜 단위로 합치지 않고 각각 따로 보여 줍니다.
 */

import type { Metadata } from "next";

import {
  MOCK_ALLOCATIONS,
  MOCK_USAGE_EVENTS,
  SEASON_RANGE,
  formatCompact,
  formatDate,
  formatNumber,
  seasonDaysRemaining,
  usedPercent,
} from "@/lib/mock-data";

import styles from "./usage.module.css";

export const metadata: Metadata = {
  title: "Usage — Ctrl AI",
};

/** 토큰은 650K처럼 줄여 쓰고, 크레딧처럼 작은 수는 그대로 보여 줍니다. */
function displayAmount(value: number, unit: string): string {
  return unit === "토큰" ? formatCompact(value) : formatNumber(value);
}

export default function UsagePage() {
  const daysLeft = seasonDaysRemaining();

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          Usage <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          이번 시즌에 남은 사용량입니다. 제공자마다 계산 단위가 달라 따로 보여 드립니다.
        </p>
      </header>

      <div className={styles.seasonBar}>
        <div>
          <p className={styles.seasonName}>{SEASON_RANGE.name}</p>
          <p className={styles.seasonRange}>
            {formatDate(SEASON_RANGE.startsAt)} – {formatDate(SEASON_RANGE.endsAt)}
          </p>
        </div>
        <span className="badge badge-ok">활동 회원</span>
        <span className={styles.seasonSpacer} />
        <span className={styles.seasonDday}>
          시즌 종료까지
          <span className={styles.seasonDdayValue}>{daysLeft}일</span>
        </span>
      </div>

      <div className={styles.allocations}>
        {MOCK_ALLOCATIONS.map((allocation, index) => {
          const remaining = allocation.allocated - allocation.used;
          const percent = usedPercent(allocation);

          return (
            <section className="card" key={allocation.provider}>
              <div className={styles.allocation}>
                <div className={styles.allocationHead}>
                  <div>
                    <p className={styles.provider}>{allocation.label}</p>
                    <p className={styles.resource}>
                      {allocation.provider} · {allocation.resourceType}
                    </p>
                  </div>
                  <span className="badge badge-accent">{percent}% 사용</span>
                </div>

                <div>
                  <p className={styles.headline}>
                    <span className={styles.headlineUsed}>
                      {displayAmount(allocation.used, allocation.unit)}
                    </span>
                    <span className={styles.headlineTotal}>
                      / {displayAmount(allocation.allocated, allocation.unit)}
                    </span>
                    <span className={styles.headlineSuffix}>{allocation.unit} 사용</span>
                  </p>
                </div>

                <div
                  className="meter"
                  role="img"
                  aria-label={`${allocation.label} 중 ${percent}% 사용`}
                >
                  <div
                    className={`meter-fill ${index === 1 ? "meter-fill-blue" : ""}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <p className={styles.remaining}>
                  <span>남은 사용량</span>
                  <span className={styles.remainingValue}>
                    {displayAmount(remaining, allocation.unit)} {allocation.unit}
                  </span>
                </p>

                <p className={styles.note}>{allocation.note}</p>
              </div>
            </section>
          );
        })}
      </div>

      <h2 className="section-title">최근 사용 내역</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">날짜</th>
              <th scope="col">제공자</th>
              <th scope="col">사용한 곳</th>
              <th scope="col">사용량</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_USAGE_EVENTS.map((event, index) => (
              <tr key={`${event.date}-${index}`}>
                <td className="numeric">{event.date}</td>
                <td>{event.provider}</td>
                <td>{event.detail}</td>
                <td className="numeric">{event.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="notice" style={{ marginTop: "1.1rem", marginBottom: 0 }}>
        <strong>예시로 보여 드리는 수치입니다.</strong> 할당과 사용 기록은 Phase 1에서 만들고,
        Phase 2부터 실제로 사용량이 줄어듭니다.
      </p>
    </>
  );
}
