"use client";

/**
 * Usage 화면 맨 위의 분기 막대.
 *
 * 분기 이름, 기간, 회원 상태, 남은 일수는 모두 백엔드에서 옵니다.
 * 아래쪽 금액과 사용 내역은 아직 목업입니다(Phase 1c).
 *
 * 참여하지 않는 회원에게는 왜 새로 만들 수 없는지 한 줄로 설명합니다.
 * 버튼만 막아 두면 고장처럼 보이기 때문입니다.
 */

import {
  MEMBERSHIP_BADGE,
  MEMBERSHIP_LABEL,
  NOT_PARTICIPATING_HINT,
  formatDate,
} from "@/lib/quarters";

import { useMyQuarter } from "@/app/components/MyQuarterProvider";

import styles from "./usage.module.css";

export default function QuarterBar() {
  const { state } = useMyQuarter();

  if (state.phase === "loading") {
    return <p className="small muted">불러오는 중…</p>;
  }
  if (state.phase === "error" || state.quarter.quarter === null) {
    return (
      <div className={styles.seasonBar}>
        <p className="small muted">분기 정보를 불러오지 못했습니다.</p>
      </div>
    );
  }

  const { quarter, days_remaining, membership_status, may_create } = state.quarter;
  const status = membership_status ?? "inactive";

  return (
    <>
      <div className={styles.seasonBar}>
        <div>
          <p className={styles.seasonName}>{quarter.display_name}</p>
          <p className={styles.seasonRange}>
            {formatDate(quarter.starts_at)} – {formatDate(quarter.ends_at)}
          </p>
        </div>
        <span className={`badge ${MEMBERSHIP_BADGE[status]}`}>{MEMBERSHIP_LABEL[status]}</span>
        <span className={styles.seasonSpacer} />
        {days_remaining !== null && (
          <span className={styles.seasonDday}>
            <span>분기 종료까지</span>
            {/* 숫자와 "일"을 한 덩어리로 묶습니다. 바깥이 gap 있는 flex라
                따로 두면 "91 일"처럼 사이가 벌어집니다. */}
            <span>
              <span className={styles.seasonDdayValue}>{days_remaining}</span>일
            </span>
          </span>
        )}
      </div>

      {!may_create && <p className="notice">{NOT_PARTICIPATING_HINT}</p>}
    </>
  );
}
