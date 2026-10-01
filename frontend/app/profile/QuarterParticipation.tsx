"use client";

/**
 * Profile — 분기 참여 신청.
 *
 * 크레딧은 자동으로 주어지지 않습니다. 관리자가 신청을 열면 회원이
 * Build/Video 비율을 정해 신청하고, 관리자가 승인해야 쓸 수 있는 예산이
 * 생깁니다.
 *
 * 비율의 합은 반드시 100%입니다. 한쪽을 움직이면 다른 쪽이 따라오므로
 * 회원이 잘못된 값을 만들 수 없습니다. 최종 금액은 백엔드가 다시 계산하며,
 * 여기 계산은 미리 보여 주기 위한 것입니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { describeError } from "@/lib/http";
import {
  APPLICATION_STATUS_LABEL,
  applyForQuarter,
  cancelApplication,
  formatDate,
  formatKrw,
  getMyQuarter,
  splitBudget,
  type MyQuarterStatus,
} from "@/lib/quarters";

import styles from "./profile.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; data: MyQuarterStatus }
  | { phase: "error"; message: string };

/** 자주 쓰는 비율. 한 번 눌러 고를 수 있게 둡니다. */
const PRESETS = [100, 70, 50, 30, 0];

export default function QuarterParticipation() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [buildPercentage, setBuildPercentage] = useState(70);
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
        await applyForQuarter(quarterId, {
          build_percentage: buildPercentage,
          video_percentage: 100 - buildPercentage,
        });
        setFormOpen(false);
        reload();
      } catch (error) {
        setState({ phase: "error", message: describeError(error) });
      } finally {
        setBusy(false);
      }
    },
    [buildPercentage, reload],
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
        <p className="small dim">분기 정보를 불러오는 중…</p>
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

  const limit = quarter.subsidy_limit_krw;
  const preview = splitBudget(buildPercentage, limit);
  const canApply = quarter.status === "application_open" && !allocation;

  return (
    <section className={styles.season} aria-label="분기 참여">
      <div className={styles.seasonTop}>
        <span className={styles.seasonName}>{quarter.display_name}</span>
        <span
          className={`badge ${
            participation === "활동 회원"
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

      {/* 승인된 경우 — 받은 지원금 */}
      {allocation && (
        <div className={styles.approvedGrid}>
          <div className={styles.approvedCell}>
            <span className={styles.seasonLabel}>Build</span>
            <span className={styles.approvedValue}>
              {formatKrw(allocation.build_budget_krw)}
            </span>
            <span className={styles.approvedSub}>{allocation.build_percentage}% 지원</span>
          </div>
          <div className={styles.approvedCell}>
            <span className={styles.seasonLabel}>Video</span>
            <span className={styles.approvedValue}>
              {formatKrw(allocation.video_budget_krw)}
            </span>
            <span className={styles.approvedSub}>{allocation.video_percentage}% 지원</span>
          </div>
        </div>
      )}

      {/* 심사 중 */}
      {!allocation && application && application.status === "submitted" && (
        <div className={styles.pending}>
          <p className={styles.pendingTitle}>
            {APPLICATION_STATUS_LABEL[application.status]}
          </p>
          <p className={styles.seasonNote}>
            Build {application.build_percentage}% ·{" "}
            {formatKrw(application.requested_build_budget_krw)} / Video{" "}
            {application.video_percentage}% ·{" "}
            {formatKrw(application.requested_video_budget_krw)}
          </p>
          <p className={styles.seasonNote}>관리자 승인 후 사용량이 활성화됩니다.</p>
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

      {/* 신청 가능 */}
      {canApply && !formOpen && !application && (
        <div className={styles.applyRow}>
          <p className={styles.seasonNote}>
            이번 분기 지원 한도는 <strong>{formatKrw(limit)}</strong>입니다. Build와 Video에
            어떻게 나눠 쓸지 정해서 신청해 주세요.
          </p>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => setFormOpen(true)}
          >
            {quarter.display_name} 참여 신청
          </button>
        </div>
      )}

      {/* 신청 양식 */}
      {canApply && formOpen && (
        <div className={styles.applyForm}>
          <p className={styles.seasonLabel}>분기 지원 한도</p>
          <p className={styles.limitValue}>{formatKrw(limit)}</p>

          <label className={styles.sliderLabel} htmlFor="build-share">
            Build / Video 비율
          </label>
          <input
            className={styles.slider}
            id="build-share"
            type="range"
            min={0}
            max={100}
            step={5}
            value={buildPercentage}
            onChange={(event) => setBuildPercentage(Number(event.target.value))}
          />

          <div className={styles.presets}>
            {PRESETS.map((value) => (
              <button
                className={`${styles.preset} ${
                  value === buildPercentage ? styles.presetActive : ""
                }`}
                key={value}
                type="button"
                onClick={() => setBuildPercentage(value)}
              >
                {value} / {100 - value}
              </button>
            ))}
          </div>

          <div className={styles.splitGrid}>
            <div className={styles.splitCell}>
              <span className={styles.seasonLabel}>Build</span>
              <span className={styles.splitPercent}>{buildPercentage}%</span>
              <span className={styles.splitAmount}>{formatKrw(preview.buildKrw)}</span>
            </div>
            <div className={styles.splitCell}>
              <span className={styles.seasonLabel}>Video</span>
              <span className={styles.splitPercent}>{100 - buildPercentage}%</span>
              <span className={styles.splitAmount}>{formatKrw(preview.videoKrw)}</span>
            </div>
          </div>

          <p className={styles.seasonNote}>
            합계 {formatKrw(preview.buildKrw + preview.videoKrw)} — 두 비율의 합은 항상
            100%입니다.
          </p>

          <div className={styles.applyActions}>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => void submit(quarter.id)}
              disabled={busy}
            >
              {busy ? "신청 중…" : "신청하기"}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setFormOpen(false)}>
              취소
            </button>
          </div>
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
