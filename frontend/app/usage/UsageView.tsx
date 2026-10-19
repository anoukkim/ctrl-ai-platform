"use client";

/**
 * Usage — 이번 분기에 쓴 돈과 남은 돈.
 *
 * 모든 숫자가 백엔드에서 옵니다. 목업은 더 이상 없습니다.
 *
 * 화면이 답해야 하는 질문은 하나입니다: "지금 얼마 남았나?" 지갑은 하나뿐이고
 * (single-wallet) 채팅, 영상, 그 밖의 모든 유료 기능이 같은 잔액에서 씁니다.
 * 그래서 큰 숫자는 남은 금액 하나이고, 채팅 / 빌더 / 영상 / 기타로 나눈
 * 사용액은 정보로만 보여 줍니다 — 따로 정해진 한도가 아닙니다.
 *
 * cost-clarity (2026-10-14): 돈이 어디로 갔는지 — 이번 분기 캐시로 아낀
 * 금액, 대화별 합계와 날짜별 합계를 답장 영수증과 같은 항목(입력 / 캐시
 * 쓰기 / 캐시 읽기 / 출력 / 도구)으로 보여 줍니다.
 *
 * 동아리 지원과 개인 잔액은 끝까지 분리합니다. 합치면 회원이 "지원을 더
 * 받았다"고 오해합니다.
 */

import { Gauge, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import EmptyState from "@/app/components/EmptyState";
import { CACHE_EXPLAINER, ROUND_UP_NOTE, formatWonPart, type MoneySplit } from "@/lib/money";
import { useSite } from "@/app/components/SiteProvider";

import {
  FUNDING_LABEL,
  membershipBadge,
  membershipLabel,
  NOT_PARTICIPATING_HINT,
  SPENDING_LABEL,
  SPENDING_ORDER_NOTE,
  formatKrw,
  getMyUsage,
  providerFriendly,
  walletSentence,
  type MemberMoney,
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
  const status = usage.membership_status;
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
          <span className={`badge ${membershipBadge(status)}`}>{membershipLabel(status)}</span>
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

      {/* 개인 잔액 — 지원금과 섞이지 않도록 따로 둡니다. 개인 충전이
          꺼져 있는 동안(personal-topup-off, 기본값)은 통째로 보이지
          않습니다: 회원이 보는 돈은 동아리 지원 하나뿐입니다. */}
      {site.top_ups_enabled && (
        <>
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
            </section>
          )}
        </>
      )}

      {usage.money && usage.money.quarter.events > 0 && <MoneySections money={usage.money} />}

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
        <span className={styles.provider}>채팅 · 빌더 · 영상 · 모든 기능 공통</span>
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

/** 항목 칸 — 0이면 "–"로 비워 둡니다(눈이 숫자에 덜 걸리게). */
function Part({ value }: { value: number }) {
  return <td className={styles.amount}>{value > 0 ? formatWonPart(value) : "–"}</td>;
}

/**
 * 돈이 어디로 갔나요 (cost-clarity): 이번 분기 캐시로 아낀 금액, 대화별,
 * 날짜별. 항목은 답장 영수증과 같습니다.
 */
function MoneySections({ money }: { money: MemberMoney }) {
  const [explain, setExplain] = useState(false);
  const quarter = money.quarter;
  return (
    <>
      <h2 className="section-title">
        돈이 어디로 갔나요
        <span className={styles.sectionNote}>이번 분기 · 영수증과 같은 항목</span>
      </h2>
      <section className={`card ${styles.moneyCard}`} data-testid="money-summary">
        <p className={styles.savedLine}>
          이번 분기 캐시로 아낀 금액{" "}
          <strong className={styles.savedValue} data-testid="quarter-cache-saved">
            약 {formatWonPart(quarter.cache_saved_krw)}
          </strong>
          <button
            type="button"
            className={styles.infoButton}
            aria-label="캐시가 무엇인가요?"
            aria-expanded={explain}
            onClick={() => setExplain((open) => !open)}
          >
            ⓘ
          </button>
        </p>
        {explain && <p className={styles.explain}>{CACHE_EXPLAINER}</p>}
        <p className={styles.splitSummary}>{summaryLine(quarter)}</p>
        <p className="small dim">
          {ROUND_UP_NOTE}
          {quarter.estimated ? " 오래된 기록 일부는 지금 요금표로 다시 계산한 어림값입니다." : ""}
        </p>
      </section>

      {money.by_conversation.length > 0 && (
        <>
          <h3 className={styles.subTitle}>대화별</h3>
          <div className="table-wrap">
            <table className="table" data-testid="money-by-conversation">
              <thead>
                <tr>
                  <th scope="col">대화</th>
                  <th scope="col">답장</th>
                  <th scope="col">입력</th>
                  <th scope="col">캐시 쓰기</th>
                  <th scope="col">캐시 읽기</th>
                  <th scope="col">출력</th>
                  <th scope="col">도구</th>
                  <th scope="col">합계</th>
                  <th scope="col">캐시로 아낀 금액</th>
                </tr>
              </thead>
              <tbody>
                {money.by_conversation.map((row, index) => (
                  <tr key={row.conversation_id ?? `deleted-${index}`}>
                    <td>{row.title}</td>
                    <td className={styles.amount}>{row.split.events}</td>
                    <Part value={row.split.input_krw} />
                    <Part value={row.split.cache_write_krw} />
                    <Part value={row.split.cache_read_krw} />
                    <Part value={row.split.output_krw} />
                    <Part value={row.split.tools_krw} />
                    <td className={styles.amount}>{formatKrw(row.split.charged_krw)}</td>
                    <Part value={row.split.cache_saved_krw} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className={styles.subTitle}>날짜별</h3>
      <div className="table-wrap">
        <table className="table" data-testid="money-by-day">
          <thead>
            <tr>
              <th scope="col">날짜</th>
              <th scope="col">건수</th>
              <th scope="col">입력</th>
              <th scope="col">캐시 쓰기</th>
              <th scope="col">캐시 읽기</th>
              <th scope="col">출력</th>
              <th scope="col">도구</th>
              <th scope="col">기타</th>
              <th scope="col">합계</th>
              <th scope="col">캐시로 아낀 금액</th>
            </tr>
          </thead>
          <tbody>
            {money.by_day.map((row) => (
              <tr key={row.day}>
                <td className={styles.when}>{row.day.replaceAll("-", ".")}</td>
                <td className={styles.amount}>{row.split.events}</td>
                <Part value={row.split.input_krw} />
                <Part value={row.split.cache_write_krw} />
                <Part value={row.split.cache_read_krw} />
                <Part value={row.split.output_krw} />
                <Part value={row.split.tools_krw} />
                <Part value={row.split.other_krw} />
                <td className={styles.amount}>{formatKrw(row.split.charged_krw)}</td>
                <Part value={row.split.cache_saved_krw} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** "입력 120원 · 캐시 쓰기 30원 · … · 합계 1,234원" — 이번 분기 전체. */
function summaryLine(split: MoneySplit): string {
  const parts: string[] = [];
  const pairs: [string, number][] = [
    ["입력", split.input_krw],
    ["캐시 쓰기", split.cache_write_krw],
    ["캐시 읽기", split.cache_read_krw],
    ["출력", split.output_krw],
    ["도구", split.tools_krw],
    ["기타(영상 등)", split.other_krw],
  ];
  for (const [label, value] of pairs) {
    if (value > 0) parts.push(`${label} ${formatWonPart(value)}`);
  }
  parts.push(`합계 ${formatKrw(split.charged_krw)}`);
  return parts.join(" · ");
}
