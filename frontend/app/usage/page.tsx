/**
 * Usage — 이번 분기 사용량.
 *
 * 공동체 지원과 개인 잔액을 분명히 나눠서 보여 줍니다. 개인 충전금은
 * 100,000원 지원 한도에 포함되지 않습니다. 둘을 한 숫자로 합치면 회원이
 * "지원을 더 받았다"고 오해하게 되므로, 화면에서도 끝까지 분리합니다.
 *
 * 금액의 기준은 원(KRW)입니다. 토큰이나 생성 횟수로 환산하지 않습니다.
 */

import type { Metadata } from "next";

import {
  MOCK_COMMUNITY_BUDGETS,
  MOCK_PERSONAL_BALANCE,
  MOCK_USAGE_EVENTS,
  usedPercent,
} from "@/lib/mock-data";
import { formatKrw } from "@/lib/quarters";

import QuarterBar from "./QuarterBar";

import styles from "./usage.module.css";

export const metadata: Metadata = {
  title: "Usage — CTRL+AI",
};

export default function UsagePage() {
  const totalBudget = MOCK_COMMUNITY_BUDGETS.reduce((sum, b) => sum + b.budgetKrw, 0);
  const personalRemaining =
    MOCK_PERSONAL_BALANCE.balanceKrw - MOCK_PERSONAL_BALANCE.consumedKrw;

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          Usage <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          이번 분기에 남은 지원 금액입니다. 공동체 지원과 개인 충전금은 따로 계산됩니다.
        </p>
      </header>

      <QuarterBar />

      {/* 공동체 지원 */}
      <h2 className="section-title">
        공동체 지원
        <span className={styles.sectionNote}>이번 분기 지원 {formatKrw(totalBudget)}</span>
      </h2>

      <div className={styles.allocations}>
        {MOCK_COMMUNITY_BUDGETS.map((budget, index) => {
          const remaining = budget.budgetKrw - budget.consumedKrw;
          const percent = usedPercent(budget);

          return (
            <section className="card" key={budget.category}>
              <div className={styles.allocation}>
                <div className={styles.allocationHead}>
                  <div>
                    <p className={styles.provider}>{budget.label}</p>
                    <p className={styles.resource}>
                      {budget.category === "build" ? "Claude" : "Higgsfield"}
                    </p>
                  </div>
                  <span className="badge badge-accent">{percent}% 사용</span>
                </div>

                <p className={styles.headline}>
                  <span className={styles.headlineUsed}>{formatKrw(budget.consumedKrw)}</span>
                  <span className={styles.headlineTotal}>/ {formatKrw(budget.budgetKrw)}</span>
                  <span className={styles.headlineSuffix}>사용</span>
                </p>

                <div
                  className="meter"
                  role="img"
                  aria-label={`${budget.label} 지원금 중 ${percent}% 사용`}
                >
                  <div
                    className={`meter-fill ${index === 1 ? "meter-fill-blue" : ""}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div className={styles.numbers}>
                  <p className={styles.numberRow}>
                    <span className={styles.numberLabel}>지원</span>
                    <span>{formatKrw(budget.budgetKrw)}</span>
                  </p>
                  <p className={styles.numberRow}>
                    <span className={styles.numberLabel}>사용</span>
                    <span>{formatKrw(budget.consumedKrw)}</span>
                  </p>
                  <p className={styles.numberRow}>
                    <span className={styles.numberLabel}>남음</span>
                    <span className={styles.remainingValue}>{formatKrw(remaining)}</span>
                  </p>
                </div>

                <p className={styles.note}>{budget.note}</p>
              </div>
            </section>
          );
        })}
      </div>

      {/* 개인 잔액 — 지원금과 섞이지 않도록 따로 둡니다. */}
      <h2 className="section-title">
        개인 잔액
        <span className={styles.sectionNote}>공동체 지원과 별도입니다</span>
      </h2>

      <section className={`card ${styles.personal}`}>
        <div className={styles.personalGrid}>
          <div className={styles.personalCell}>
            <span className={styles.personalLabel}>충전 잔액</span>
            <span className={styles.personalValue}>
              {formatKrw(MOCK_PERSONAL_BALANCE.balanceKrw)}
            </span>
          </div>
          <div className={styles.personalCell}>
            <span className={styles.personalLabel}>개인 사용</span>
            <span className={styles.personalValue}>
              {formatKrw(MOCK_PERSONAL_BALANCE.consumedKrw)}
            </span>
          </div>
          <div className={styles.personalCell}>
            <span className={styles.personalLabel}>남은 개인 잔액</span>
            <span className={`${styles.personalValue} ${styles.personalRemaining}`}>
              {formatKrw(personalRemaining)}
            </span>
          </div>
        </div>

        <p className={styles.personalNote}>
          개인 충전금은 분기 지원 한도에 포함되지 않습니다. 공동체 지원을 다 쓰면 기본적으로
          사용이 멈추고, 회원이 개인 사용을 직접 켠 경우에만 개인 잔액에서 차감됩니다.{" "}
          {MOCK_PERSONAL_BALANCE.overageEnabled
            ? "현재 개인 사용이 켜져 있습니다."
            : "현재 개인 사용이 꺼져 있습니다."}
        </p>
      </section>

      <h2 className="section-title">최근 사용 내역</h2>
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
            {MOCK_USAGE_EVENTS.map((event, index) => (
              <tr key={`${event.date}-${index}`}>
                <td className="numeric">{event.date}</td>
                <td>
                  <span className="badge badge-muted">{event.category}</span>
                </td>
                <td>{event.detail}</td>
                <td>{event.provider}</td>
                <td className="numeric">{formatKrw(event.chargedKrw)}</td>
                <td>
                  <span
                    className={`badge ${
                      event.source === "개인 잔액" ? "badge-warn" : "badge-ok"
                    }`}
                  >
                    {event.source}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="notice" style={{ marginTop: "1.1rem", marginBottom: 0 }}>
        <strong>예시로 보여 드리는 수치입니다.</strong> 실제 차감은 제공자를 연결한 뒤에
        시작됩니다. 금액은 모두 원(KRW) 기준이며, 토큰이나 생성 횟수로 환산해 저장하지
        않습니다.
      </p>
    </>
  );
}
