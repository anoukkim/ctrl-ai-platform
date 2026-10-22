"use client";

/**
 * 신청 기한 연장 (ui-improvements B) — 분기의 신청 마감일을 뒤로 늦춥니다.
 * admin-ui-unify부터 오른쪽 판(`SidePanel`)에 열립니다.
 *
 * 두 경우를 한 창이 맡습니다.
 * - 신청 접수 중인 분기: 마감일만 늦춥니다.
 * - 신청을 이미 마감한(진행 중) 분기: 마감일을 늦추면서 신청을 다시 엽니다.
 *   지갑은 건드리지 않으므로 되돌릴 수 있는 일입니다.
 *
 * 분기 마감(closed)은 지갑을 멈추고 회수를 적은 뒤라 다시 열지 않습니다 —
 * 그 줄에서는 이 메뉴가 꺼져 있고, 백엔드도 409로 거절합니다.
 *
 * 날짜의 하한(오늘)과 상한(분기 종료일)은 고르개의 min/max로도, 백엔드에서도
 * 지킵니다. 고르개는 서버까지 다녀오지 않기 위한 것이고 진짜 방벽은
 * 백엔드입니다.
 */

import { useState } from "react";

import { describeError } from "@/lib/http";
import { todayKst } from "@/lib/quarter-code";
import { formatDate, updateQuarter, type Quarter } from "@/lib/quarters";

import { PanelSection, SidePanel } from "../components/AdminUI";

import styles from "./quarters.module.css";

export default function ExtendDeadlineDialog({
  quarter,
  onClose,
  onExtended,
}: {
  quarter: Pick<
    Quarter,
    "id" | "display_name" | "status" | "ends_at" | "application_closes_at"
  >;
  onClose: () => void;
  /** 저장된 뒤 — 결과 문장을 받아 바깥의 ResultMessage에 띄웁니다. */
  onExtended: (message: string) => void;
}) {
  const reopening = quarter.status === "active";
  const today = todayKst();
  const deadline = quarter.application_closes_at;
  // 연장: 지금 마감일이 아직 안 지났으면 그 다음 날부터, 지났으면 오늘부터 —
  // 창이 열릴 때부터 유효한 날짜가 들어 있어야 빈 경고로 시작하지 않습니다.
  // 다시 열기: 마감일을 그대로 둘 수도 있으므로 지금 마감일(또는 오늘)부터.
  const min = reopening
    ? deadline && deadline > today
      ? deadline
      : today
    : deadline && deadline >= today
      ? nextDay(deadline)
      : today;
  const [closesAt, setClosesAt] = useState(min);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem =
    closesAt === ""
      ? "날짜를 골라 주세요."
      : closesAt < today
        ? "신청 마감일은 오늘이거나 그 뒤여야 합니다."
        : closesAt > quarter.ends_at
          ? "신청 마감일은 분기 종료일보다 뒤일 수 없습니다."
          : quarter.application_closes_at && closesAt <= quarter.application_closes_at && !reopening
            ? "지금 마감일보다 뒤여야 연장입니다."
            : null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await updateQuarter(quarter.id, {
        application_closes_at: closesAt,
        ...(reopening ? { status: "application_open" as const } : {}),
      });
      onExtended(
        reopening
          ? `${quarter.display_name}의 신청을 다시 열었습니다. 마감일은 ${formatDate(closesAt)}입니다.`
          : `${quarter.display_name}의 신청 마감일을 ${formatDate(closesAt)}로 늦췄습니다.`,
      );
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  const title = `${quarter.display_name} ${reopening ? "신청 다시 열기" : "신청 기한 연장"}`;
  return (
    <SidePanel
      title={title}
      subtitle={`분기 종료 ${formatDate(quarter.ends_at)}`}
      onClose={onClose}
      testId="extend-deadline"
      footer={
        <>
          <button className="btn btn-sm" type="button" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            onClick={() => void confirm()}
            disabled={busy || problem !== null}
          >
            {busy ? "저장 중…" : reopening ? "신청 다시 열기" : "기한 연장"}
          </button>
        </>
      }
    >
      <PanelSection title="신청 마감일">
        <div className={styles.formField}>
          <label htmlFor="extend-deadline-date">새 신청 마감일</label>
          <input
            id="extend-deadline-date"
            type="date"
            min={min}
            max={quarter.ends_at}
            value={closesAt}
            onChange={(event) => setClosesAt(event.target.value)}
          />
          {problem !== null && closesAt !== "" && (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          )}
        </div>
        <p className={styles.hint}>
          지금 마감일은{" "}
          {quarter.application_closes_at ? formatDate(quarter.application_closes_at) : "정해지지 않았어요"}. 새
          마감일은 분기 종료일({formatDate(quarter.ends_at)}) 안이어야 해요.
        </p>
      </PanelSection>
      <PanelSection title="바뀌는 것">
        {reopening && <p className={styles.hint}>회원이 Profile에서 이 분기에 다시 신청할 수 있게 돼요.</p>}
        <p className={styles.hint}>이미 승인된 지갑과 신청은 그대로예요. 감사 기록에 남아요.</p>
      </PanelSection>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </SidePanel>
  );
}

/** The day after an ISO date (YYYY-MM-DD), in the calendar — no time zone. */
function nextDay(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
