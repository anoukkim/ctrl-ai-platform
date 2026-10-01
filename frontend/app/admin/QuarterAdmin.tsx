"use client";

/**
 * Admin — 분기와 참여 신청 관리.
 *
 * 관리자가 분기 신청을 열고 닫고, 올라온 신청의 Build/Video 배분을 보고
 * 승인하거나 거절합니다. 승인하면 그 회원이 실제로 쓸 수 있는 예산이
 * 만들어집니다.
 *
 * 승인은 신청한 금액을 그대로 가져갑니다. 금액을 조정하는 흐름은 모델이
 * 지원하지만 화면에는 아직 두지 않았습니다 — 지금 필요한 것은 승인/거절뿐
 * 입니다.
 */

import { useCallback, useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { describeError } from "@/lib/http";
import {
  APPLICATION_STATUS_LABEL,
  QUARTER_STATUS_BADGE,
  QUARTER_STATUS_LABEL,
  confirmTopUp,
  formatDate,
  formatKrw,
  listAllTopUps,
  listQuarterApplications,
  listQuarters,
  reviewApplication,
  updateQuarter,
  type ApplicationWithMember,
  type Quarter,
  type TopUp,
} from "@/lib/quarters";

import styles from "./admin.module.css";

export default function QuarterAdmin() {
  const [quarters, setQuarters] = useState<Quarter[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applications, setApplications] = useState<ApplicationWithMember[]>([]);
  const [topUps, setTopUps] = useState<TopUp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [appQuery, setAppQuery] = useState("");
  const [appStatus, setAppStatus] = useState("all");

  // 첫 로드. 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    Promise.all([listQuarters(), listAllTopUps()])
      .then(([loadedQuarters, loadedTopUps]) => {
        if (cancelled) return;
        setQuarters(loadedQuarters);
        setTopUps(loadedTopUps);
        setSelectedId((current) => current ?? loadedQuarters[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 고른 분기의 신청 목록
  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;

    listQuarterApplications(selectedId)
      .then((list) => {
        if (!cancelled) setApplications(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const refreshApplications = useCallback(async () => {
    if (selectedId === null) return;
    try {
      setApplications(await listQuarterApplications(selectedId));
    } catch (err) {
      setError(describeError(err));
    }
  }, [selectedId]);

  const review = useCallback(
    async (applicationId: number, approve: boolean) => {
      setBusy(true);
      try {
        await reviewApplication(applicationId, approve);
        await refreshApplications();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
    },
    [refreshApplications],
  );

  const toggleApplications = useCallback(
    async (quarter: Quarter) => {
      setBusy(true);
      try {
        const next = quarter.status === "application_open" ? "closed" : "application_open";
        const updated = await updateQuarter(quarter.id, { status: next });
        setQuarters((current) =>
          (current ?? []).map((q) => (q.id === updated.id ? updated : q)),
        );
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleTopUp = useCallback(async (topUpId: number, confirm: boolean) => {
    setBusy(true);
    try {
      await confirmTopUp(topUpId, confirm, confirm ? "관리자 확인" : undefined);
      setTopUps(await listAllTopUps());
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  if (error) {
    return (
      <section>
        <h2 className="section-title">분기 관리</h2>
        <div className="card">
          <p className="small muted">분기 정보를 불러오지 못했습니다. {error}.</p>
        </div>
      </section>
    );
  }

  if (quarters === null) {
    return (
      <section>
        <h2 className="section-title">분기 관리</h2>
        <p className="small muted">불러오는 중…</p>
      </section>
    );
  }

  const selected = quarters.find((q) => q.id === selectedId) ?? null;
  const pending = applications.filter((a) => a.status === "submitted").length;
  const approved = applications.filter((a) => a.status === "approved").length;
  const rejected = applications.filter((a) => a.status === "rejected").length;

  const visibleApplications = applications.filter(
    (application) =>
      matchesQuery(appQuery, application.display_name, application.username) &&
      (appStatus === "all" || application.status === appStatus),
  );

  return (
    <>
      <section>
        <h2 className="section-title">분기 관리</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">분기</th>
                <th scope="col">기간</th>
                <th scope="col">신청 기간</th>
                <th scope="col">상태</th>
                <th scope="col">지원 한도</th>
                <th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {quarters.map((quarter) => (
                <tr key={quarter.id}>
                  <td>
                    <button
                      className={`${styles.quarterPick} ${
                        quarter.id === selectedId ? styles.quarterPickActive : ""
                      }`}
                      type="button"
                      onClick={() => setSelectedId(quarter.id)}
                    >
                      {quarter.display_name}
                    </button>
                  </td>
                  <td className="numeric">
                    {formatDate(quarter.starts_at)} – {formatDate(quarter.ends_at)}
                  </td>
                  <td className="numeric">
                    {quarter.application_opens_at
                      ? `${formatDate(quarter.application_opens_at)} – ${formatDate(
                          quarter.application_closes_at,
                        )}`
                      : "—"}
                  </td>
                  <td>
                    <span className={`badge ${QUARTER_STATUS_BADGE[quarter.status]}`}>
                      {QUARTER_STATUS_LABEL[quarter.status]}
                    </span>
                  </td>
                  <td className="numeric">{formatKrw(quarter.subsidy_limit_krw)}</td>
                  <td>
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => void toggleApplications(quarter)}
                      disabled={busy}
                    >
                      {quarter.status === "application_open" ? "신청 마감" : "신청 열기"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section>
          <h2 className="section-title">
            {selected.display_name} 참여 신청
            <span className={styles.applicationCounts}>
              전체 {applications.length} · 대기 {pending} · 승인 {approved} · 거절 {rejected}
            </span>
          </h2>

          {applications.length > 0 && (
            <SearchBar
              value={appQuery}
              onChange={setAppQuery}
              placeholder="회원 이름이나 아이디로 검색"
              resultCount={visibleApplications.length}
              totalCount={applications.length}
              filters={[
                {
                  key: "status",
                  label: "상태",
                  value: appStatus,
                  onChange: setAppStatus,
                  options: [
                    { value: "all", label: "전체" },
                    ...Object.entries(APPLICATION_STATUS_LABEL).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ],
                },
              ]}
            />
          )}

          {applications.length === 0 ? (
            <div className="card">
              <p className="small muted">아직 들어온 신청이 없습니다.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">회원</th>
                    <th scope="col">Build</th>
                    <th scope="col">Video</th>
                    <th scope="col">합계</th>
                    <th scope="col">상태</th>
                    <th scope="col">심사</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleApplications.map((application) => (
                    <tr key={application.id}>
                      <td>
                        <span className={styles.memberName}>
                          {application.display_name}
                          <span className={styles.memberHandle}>@{application.username}</span>
                        </span>
                      </td>
                      <td className="numeric">
                        {application.build_percentage}% ·{" "}
                        {formatKrw(application.requested_build_budget_krw)}
                      </td>
                      <td className="numeric">
                        {application.video_percentage}% ·{" "}
                        {formatKrw(application.requested_video_budget_krw)}
                      </td>
                      <td className="numeric">
                        {formatKrw(application.requested_total_budget_krw)}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            application.status === "approved"
                              ? "badge-ok"
                              : application.status === "rejected"
                                ? "badge-error"
                                : application.status === "submitted"
                                  ? "badge-warn"
                                  : "badge-muted"
                          }`}
                        >
                          {APPLICATION_STATUS_LABEL[application.status]}
                        </span>
                      </td>
                      <td>
                        {application.status === "submitted" ? (
                          <span className={styles.rowActions}>
                            <button
                              className="btn btn-sm"
                              type="button"
                              onClick={() => void review(application.id, true)}
                              disabled={busy}
                            >
                              승인
                            </button>
                            <button
                              className="btn btn-sm"
                              type="button"
                              onClick={() => void review(application.id, false)}
                              disabled={busy}
                            >
                              거절
                            </button>
                          </span>
                        ) : (
                          <span className="small dim">처리됨</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="section-title">개인 충전 신청</h2>
        {topUps.length === 0 ? (
          <div className="card">
            <p className="small muted">
              아직 충전 신청이 없습니다. 입금 확인은 관리자가 직접 처리합니다 — 결제
              서비스는 연결하지 않았습니다.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">회원</th>
                  <th scope="col">금액</th>
                  <th scope="col">상태</th>
                  <th scope="col">처리</th>
                </tr>
              </thead>
              <tbody>
                {topUps.map((topUp) => (
                  <tr key={topUp.id}>
                    <td className="numeric">#{topUp.user_id}</td>
                    <td className="numeric">{formatKrw(topUp.amount_krw)}</td>
                    <td>
                      <span
                        className={`badge ${
                          topUp.status === "confirmed"
                            ? "badge-ok"
                            : topUp.status === "requested"
                              ? "badge-warn"
                              : "badge-muted"
                        }`}
                      >
                        {topUp.status}
                      </span>
                    </td>
                    <td>
                      {topUp.status === "requested" ? (
                        <span className={styles.rowActions}>
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => void handleTopUp(topUp.id, true)}
                            disabled={busy}
                          >
                            입금 확인
                          </button>
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => void handleTopUp(topUp.id, false)}
                            disabled={busy}
                          >
                            거절
                          </button>
                        </span>
                      ) : (
                        <span className="small dim">처리됨</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
