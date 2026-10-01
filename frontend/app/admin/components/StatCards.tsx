"use client";

/**
 * 작은 숫자 카드 한 줄 — 누르면 목록이 걸러집니다.
 *
 * 세 화면이 같은 모양을 씁니다(신청 승인, 회원, 그리고 대시보드의 분기
 * 요약). 화면마다 따로 그리면 카드 크기와 숫자 정렬이 조금씩 달라지고,
 * 나란히 놓였을 때 그 차이가 눈에 띕니다.
 *
 * 숫자는 전부 백엔드의 묶음 질의에서 옵니다. 목록을 받아 브라우저에서
 * 세면 지금은 맞지만, 거르기를 걸어 둔 순간 "전체"가 아니라 "보이는
 * 것"을 세게 됩니다.
 *
 * 누를 수 있는 카드는 `<button>`입니다. 보기에는 카드지만 하는 일은
 * 거르기이므로, 키보드와 화면 낭독기에는 단추로 보여야 합니다.
 */

import styles from "../admin.module.css";

export interface StatCard {
  key: string;
  label: string;
  value: number | string;
  /** 숫자 뒤에 붙는 단위 — 명, 원, 건. */
  unit?: string;
  /** 손이 필요한 수. 강조해서 그립니다. */
  accent?: boolean;
}

export default function StatCards({
  cards,
  active,
  onSelect,
  clearLabel = "전체 보기",
}: {
  cards: StatCard[];
  /** 지금 걸려 있는 거르기의 카드 키. 없으면 아무것도 강조하지 않습니다. */
  active?: string | null;
  /** 없으면 카드는 그냥 숫자판이고, 누를 수 없습니다. */
  onSelect?: (key: string) => void;
  clearLabel?: string;
}) {
  const clickable = onSelect !== undefined;

  return (
    <div className={styles.statRow}>
      {cards.map((card) => {
        const isActive = active != null && active === card.key;
        const className = `${styles.statCard} ${card.accent ? styles.statCardAccent : ""} ${
          isActive ? styles.statCardActive : ""
        }`;

        const inner = (
          <>
            <span className={styles.statCardValue}>
              {typeof card.value === "number" ? card.value.toLocaleString("ko-KR") : card.value}
              {card.unit && <span className={styles.statCardUnit}>{card.unit}</span>}
            </span>
            <span className={styles.statCardLabel}>{card.label}</span>
          </>
        );

        if (!clickable) {
          return (
            <div className={className} key={card.key}>
              {inner}
            </div>
          );
        }

        return (
          <button
            className={className}
            key={card.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(card.key)}
          >
            {inner}
          </button>
        );
      })}

      {/* 거르기를 푸는 길. 눌러서 걸 수 있으면 풀 수도 있어야 합니다. */}
      {clickable && active != null && (
        <button
          className={`${styles.statCard} ${styles.statCardClear}`}
          type="button"
          onClick={() => onSelect("")}
        >
          <span className={styles.statCardClearMark} aria-hidden="true">
            ✕
          </span>
          <span className={styles.statCardLabel}>{clearLabel}</span>
        </button>
      )}
    </div>
  );
}
