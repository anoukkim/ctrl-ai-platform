"use client";

/**
 * Usage — 이번 분기에 쓴 돈과 남은 돈.
 *
 * 모든 숫자가 백엔드에서 옵니다. 목업은 더 이상 없습니다.
 *
 * 화면이 답해야 하는 질문은 하나입니다: "지금 얼마 남았나?" 지갑은 하나뿐이고
 * (single-wallet) 채팅, 영상, 그 밖의 모든 유료 기능이 같은 잔액에서 씁니다.
 * 그래서 큰 숫자는 남은 금액 하나이고, 채팅 / 영상 / 기타로 나눈 사용액은
 * 정보로만 보여 줍니다 — 따로 정해진 한도가 아닙니다.
 *
 * 동아리 지원과 개인 잔액은 끝까지 분리합니다. 합치면 회원이 "지원을 더
 * 받았다"고 오해합니다.
 */

import { Gauge, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import EmptyState from "@/app/components/EmptyState";
import { useSite } from "@/app/components/SiteProvider";

import {
  FUNDING_LABEL,
  MEMBERSHIP_BADGE,
  MEMBERSHIP_LABEL,
  NOT_PARTICIPATING_HINT,
  SPENDING_LABEL,
  SPENDING_ORDER_NOTE,
  formatKrw,
  getMyUsage,
  providerFriendly,
  walletSentence,
  type MyUsage,
  type SpendingLine,
  type WalletUsage,
} from "@/lib/quarters";
import { describeError } from "@/lib/http";

import styles from "./usage.module.css";
import Skeleton from "@/app/components/Skeleton";

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
  const site = useSite();

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
    return <Skeleton />;
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

      {/* 동아리 지원 — 지갑 하나 */}
      <h2 className="section-title">동아리 지원</h2>

      {usage.wallet === null ? (
        <div className="card" style={{ marginBottom: "1.6rem" }}>
          <p className="small muted">
            아직 승인된 지원금이 없습니다. Profile에서 이번 분기 참여를 신청할 수 있습니다.
          </p>
        </div>
      ) : (
        <WalletCard wallet={usage.wallet} breakdown={usage.breakdown} />
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
            {SPENDING_ORDER_NOTE}{" "}
            {personal.overage_enabled
              ? "지금은 개인 사용이 켜져 있습니다."
              : "지금은 개인 사용이 꺼져 있어, 지원금을 다 쓰면 사용이 멈춥니다."}
          </p>
          {!site.top_ups_enabled && (
            <p className={styles.personalNote} data-testid="top-ups-off">
              베타 기간에는 개인 충전을 받지 않습니다. 동아리 지원금으로 이용해 주세요.
            </p>
          )}
        </section>
      )}

      {/* 최근 사용 내역 */}
      <h2 className="section-title">최근 사용 내역</h2>

      {usage.events.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="아직 쓴 기록이 없어요"
          text="Chat에서 질문하거나 Project Builder, Video Generator에서 무언가를 만들면 쓴 금액이 여기에 쌓여요."
          action={{ label: "Chat에서 시작하기", href: "/" }}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">구분</th>
                <th scope="col">사용한 곳</th>
                <th scope="col">만든 곳</th>
                <th scope="col">금액</th>
                <th scope="col">차감</th>
              </tr>
            </thead>
            <tbody>
              {usage.events.map((event) => (
                <tr key={event.id}>
                  <td className={styles.when}>{formatDay(event.created_at)}</td>
                  <td>
                    <span className="badge badge-muted">{SPENDING_LABEL[event.group]}</span>
                  </td>
                  <td>{event.label}</td>
                  <td>{providerFriendly(event.provider)}</td>
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

/**
 * 동아리 지원 지갑 한 장.
 *
 * 큰 숫자(남은 금액) / 막대 / 한 문장, 그리고 "어디에 썼나요". 아래쪽
 * 세 줄은 정보일 뿐이라 막대 색을 나누지 않고, 한도처럼 보이지 않게
 * 남은 금액이 아닌 쓴 금액만 적습니다.
 */
function WalletCard({ wallet, breakdown }: { wallet: WalletUsage; breakdown: SpendingLine[] }) {
  const percent =
    wallet.budget_krw > 0
      ? Math.min(100, Math.round((wallet.consumed_krw / wallet.budget_krw) * 100))
      : 0;

  return (
    <section className={`${styles.card} ${styles.walletCard}`} aria-labelledby="wallet-title">
      <div className={styles.cardHead}>
        <span className={`${styles.cardIcon} ${styles.cardIconWallet}`} aria-hidden="true">
          <Wallet size={15} />
        </span>
        <span className={styles.cardTitle} id="wallet-title">
          이번 분기 지원금
        </span>
        <span className={styles.provider}>채팅 · 영상 · 모든 기능 공통</span>
      </div>

      <p className={styles.remaining}>
        <span className={styles.remainingValue}>{formatKrw(wallet.remaining_krw)}</span>
        <span className={styles.remainingLabel}>남음</span>
      </p>

      <div className="meter" role="img" aria-label={`지원금 중 ${percent}% 사용`}>
        <div className="meter-fill" style={{ width: `${percent}%` }} />
      </div>

      <p className={styles.cardFoot}>{walletSentence(wallet)}</p>

      {breakdown.length > 0 && (
        <div className={styles.breakdown}>
          <p className={styles.breakdownTitle}>
            어디에 썼나요 <span className={styles.breakdownHint}>참고용 · 모두 같은 지갑에서 나갑니다</span>
          </p>
          <ul className={styles.breakdownList}>
            {breakdown.map((line) => (
              <li className={styles.breakdownItem} key={line.group}>
                <span>{line.label}</span>
                <span className={styles.footNumber}>{formatKrw(line.consumed_krw)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
