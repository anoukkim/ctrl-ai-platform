"use client";

/**
 * Profile — 분기 참여 신청.
 *
 * 크레딧은 자동으로 주어지지 않습니다. 관리자가 신청을 열면 회원이
 * "이번 분기 참여"를 누르고, 관리자가 승인해야 쓸 수 있는 지원금이 생깁니다.
 *
 * 나눌 것도 고를 것도 없습니다(single-wallet). 금액은 분기가 정하고, 그
 * 지갑 하나에서 채팅, 영상 등 모든 기능이 씁니다. 금액은 백엔드가 정하며
 * 화면은 보여 주기만 합니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useSite } from "@/app/components/SiteProvider";
import { describeError } from "@/lib/http";
import {
  APPLICATION_STATUS_LABEL,
  applyForQuarter,
  cancelApplication,
  formatDate,
  formatKrw,
  getMyQuarter,
  SPENDING_ORDER_NOTE,
  walletSentence,
  type MyQuarterStatus,
} from "@/lib/quarters";

import styles from "./profile.module.css";
import Skeleton from "@/app/components/Skeleton";

type State =
  | { phase: "loading" }
  | { phase: "ready"; data: MyQuarterStatus }
  | { phase: "error"; message: string };

export default function QuarterParticipation() {
  const site = useSite();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getMyQuarter()
      .then((data) => {
        if (!cancelled) setState({ phase: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const submit = useCallback(
    async (quarterId: number) => {
      setBusy(true);
      try {
        await applyForQuarter(quarterId);
        reload();
      } catch (error) {
        setState({ phase: "error", message: describeError(error) });
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const cancel = useCallback(
    async (applicationId: number) => {
      setBusy(true);
      try {
        await cancelApplication(applicationId);
        reload();
      } catch (error) {
        setState({ phase: "error", message: describeError(error) });
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (state.phase === "loading") {
    return (
      <section className={styles.season}>
        <Skeleton label="분기 정보를 불러오는 중…" />
      </section>
    );
  }

  if (state.phase === "error") {
    return (
      <section className={styles.season}>
        <p className={styles.seasonLabel}>분기 정보를 불러오지 못했습니다</p>
        <p className={styles.seasonNote}>
          {state.message}. 백엔드가 실행 중인지 확인해 주세요.
        </p>
        <button className="btn btn-sm" type="button" onClick={reload}>
          다시 시도
        </button>
      </section>
    );
  }

  const { quarter, application, allocation, participation, days_remaining } = state.data;

  if (!quarter) {
    return (
      <section className={styles.season}>
        <div className={styles.seasonTop}>
          <span className={styles.seasonName}>진행 중인 분기가 없습니다</span>
        </div>
        <p className={styles.seasonNote}>
          다음 분기 신청이 열리면 여기에서 안내해 드립니다.
        </p>
      </section>
    );
  }

  const amount = quarter.subsidy_limit_krw;
  const canApply = quarter.status === "application_open" && !allocation;

  return (
    <section className={styles.season} aria-label="분기 참여">
      <div className={styles.seasonTop}>
        <span className={styles.seasonName}>{quarter.display_name}</span>
        <span
          className={`badge ${
            participation === "참여 중"
              ? "badge-ok"
              : participation === "승인 대기"
                ? "badge-warn"
                : participation === "신청 거절"
                  ? "badge-error"
                  : "badge-accent"
          }`}
        >
          {participation}
        </span>
        <span style={{ flex: "1 1 auto" }} />
        <Link className="btn btn-sm" href="/usage">
          사용량 보기
        </Link>
      </div>

      <div className={styles.seasonGrid}>
        <div className={styles.seasonCell}>
          <span className={styles.seasonLabel}>분기 기간</span>
          <span className={styles.seasonValue}>
            {formatDate(quarter.starts_at)} – {formatDate(quarter.ends_at)}
          </span>
        </div>
        {quarter.application_opens_at && (
          <div className={styles.seasonCell}>
            <span className={styles.seasonLabel}>신청 기간</span>
            <span className={styles.seasonValue}>
              {formatDate(quarter.application_opens_at)} –{" "}
              {formatDate(quarter.application_closes_at)}
            </span>
          </div>
        )}
        <div className={styles.seasonCell}>
          <span className={styles.seasonLabel}>종료까지</span>
          <span className={styles.seasonDday}>{days_remaining ?? 0}일 남음</span>
        </div>
      </div>

      {/* 승인된 경우 — 이번 분기 지갑 */}
      {allocation && (
        <div className={styles.approvedGrid}>
          <div className={styles.approvedCell}>
            <span className={styles.seasonLabel}>동아리 지원</span>
            <span className={styles.approvedValue}>{formatKrw(allocation.budget_krw)}</span>
            <span className={styles.approvedSub}>{walletSentence(allocation)}</span>
          </div>
          <p className={styles.seasonNote}>
            {/* 개인 충전이 꺼져 있는 동안(personal-topup-off)은 쓰는-순서
                문장을 빼고 지갑 이야기만 합니다 — 백엔드가 403으로 막는
                스위치를 소개하면 안 됩니다. */}
            채팅, 영상 등 모든 기능이 이 지원금 하나에서 차감됩니다.
            {site.top_ups_enabled ? ` ${SPENDING_ORDER_NOTE}` : ""}
          </p>
        </div>
      )}

      {/* 심사 중 */}
      {!allocation && application && application.status === "submitted" && (
        <div className={styles.pending}>
          <p className={styles.pendingTitle}>
            {APPLICATION_STATUS_LABEL[application.status]}
          </p>
          <p className={styles.seasonNote}>
            신청 금액 {formatKrw(application.requested_budget_krw)}
          </p>
          <p className={styles.seasonNote}>관리자 승인 후 사용할 수 있습니다.</p>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => void cancel(application.id)}
            disabled={busy}
          >
            신청 취소
          </button>
        </div>
      )}

      {/* 거절됨 */}
      {!allocation && application && application.status === "rejected" && (
        <div className={styles.pending}>
          <p className={styles.pendingTitle}>신청이 거절되었습니다</p>
          {application.admin_note && (
            <p className={styles.seasonNote}>사유: {application.admin_note}</p>
          )}
        </div>
      )}

      {/* 신청 가능 — 한 번 누르면 끝입니다. */}
      {canApply && !application && (
        <div className={styles.applyRow}>
          <p className={styles.seasonNote}>
            참여하면 이번 분기 지원금 <strong>{formatKrw(amount)}</strong>을 받아 채팅, 영상 등
            모든 기능에 씁니다. 관리자가 승인하면 바로 쓸 수 있습니다.
          </p>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => void submit(quarter.id)}
            disabled={busy}
          >
            {busy ? "신청 중…" : "이번 분기 참여"}
          </button>
        </div>
      )}

      {!canApply && !application && quarter.status !== "application_open" && (
        <p className={styles.seasonNote}>
          지금은 신청 기간이 아닙니다. 다음 분기 신청이 열리면 여기에서 안내해 드립니다.
        </p>
      )}
    </section>
  );
}
