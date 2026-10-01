"use client";

/**
 * Admin — 분기와 참여 신청 (/admin/quarters)
 *
 * 관리자가 분기 신청을 열고 닫고, 올라온 신청의 Build/Video 배분을 보고
 * 승인하거나 거절합니다. 승인하면 그 회원이 실제로 쓸 수 있는 예산이
 * 만들어지고, 참여 기록도 함께 쓰입니다 — 쓸 수 없는 예산을 주는 일이
 * 생기지 않도록.
 *
 * 승인은 신청한 금액을 그대로 가져갑니다. 금액을 고치는 일은 회원 상세
 * 화면의 "지원금 조정"에서 합니다. 승인과 조정을 한 버튼에 섞으면,
 * 승인된 금액이 신청한 금액과 다른데 기록에는 "승인"만 남습니다.
 *
 * 개인 충전 신청은 /admin/topups로 옮겼습니다. 돈의 출처가 다르고(동아리
 * 지원금과 개인 돈), 한 화면에 두면 더해서 읽게 됩니다.
 */

import { useCallback, useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { describeError } from "@/lib/http";
import {
  APPLICATION_STATUS_LABEL,
  formatDate,
  formatKrw,
  listQuarterApplications,
  reviewApplication,
  updateQuarter,
  type ApplicationWithMember,
  type Quarter,
} from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import AdminTable, { type Column } from "../components/AdminTable";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import ResultMessage, { type Result } from "../components/ResultMessage";
import RowMenu from "../components/RowMenu";
import { ApplicationBadge, QuarterBadge } from "../components/StatusBadge";

import styles from "../admin.module.css";

export default function QuarterAdmin() {
  const { quarters, selected, select, refresh: refreshDashboard } = useAdminQuarter();

  /**
   * 불러온 신청과 그 신청이 속한 분기를 함께 들고 있습니다. 분기를 바꿀 때
   * 목록을 `null`로 되돌리는 효과를 두지 않기 위해서입니다 — 효과 본문에서
   * 상태를 바로 바꾸면 그림이 연달아 다시 그려지고, 지난 분기의 신청을
   * 새 분기의 것처럼 잠깐 보여 주게 됩니다.
   */
  const [loaded, setLoaded] = useState<{
    quarterId: number;
    rows: ApplicationWithMember[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const quarterId = selected?.id ?? null;
  const applications =
    loaded !== null && loaded.quarterId === quarterId ? loaded.rows : null;

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (quarterId === null) return;
    let cancelled = false;

    listQuarterApplications(quarterId)
      .then((rows) => {
        if (!cancelled) setLoaded({ quarterId, rows });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [quarterId]);

  const run = useCallback(
    async (succeeded: string, action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        setResult({ kind: "ok", text: succeeded });
        if (quarterId !== null) {
          setLoaded({ quarterId, rows: await listQuarterApplications(quarterId) });
        }
        await refreshDashboard();
      } catch (caught) {
        setResult({ kind: "error", text: describeError(caught) });
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [quarterId, refreshDashboard],
  );

  if (error !== null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">분기 정보를 불러오지 못했습니다. {error}.</p>
        </div>
      </>
    );
  }

  if (quarters === null) {
    return (
      <>
        <PageHeader />
        <p className="small muted">불러오는 중…</p>
      </>
    );
  }

  const quarterColumns: Column<Quarter>[] = [
    {
      key: "quarter",
      header: "분기",
      render: (quarter) => (
        <span className={styles.memberName}>
          {quarter.display_name}
          <span className={styles.memberHandle}>{quarter.code}</span>
        </span>
      ),
    },
    {
      key: "period",
      header: "기간",
      numeric: true,
      render: (quarter) => `${formatDate(quarter.starts_at)} – ${formatDate(quarter.ends_at)}`,
    },
    {
      key: "application-period",
      header: "신청 기간",
      numeric: true,
      render: (quarter) =>
        quarter.application_opens_at
          ? `${formatDate(quarter.application_opens_at)} – ${formatDate(
              quarter.application_closes_at,
            )}`
          : "—",
    },
    {
      key: "status",
      header: "상태",
      render: (quarter) => <QuarterBadge status={quarter.status} />,
    },
    {
      key: "limit",
      header: "1인 한도",
      numeric: true,
      render: (quarter) => formatKrw(quarter.subsidy_limit_krw),
    },
  ];

  const visibleApplications = (applications ?? []).filter(
    (application) =>
      matchesQuery(query, application.display_name, application.username) &&
      (statusFilter === "all" || application.status === statusFilter),
  );

  const applicationColumns: Column<ApplicationWithMember>[] = [
    {
      key: "member",
      header: "회원",
      render: (application) => (
        <span className={styles.memberName}>
          {application.display_name}
          <span className={styles.memberHandle}>@{application.username}</span>
        </span>
      ),
    },
    {
      key: "build",
      header: "Build",
      numeric: true,
      render: (application) =>
        `${application.build_percentage}% · ${formatKrw(
          application.requested_build_budget_krw,
        )}`,
    },
    {
      key: "video",
      header: "Video",
      numeric: true,
      render: (application) =>
        `${application.video_percentage}% · ${formatKrw(
          application.requested_video_budget_krw,
        )}`,
    },
    {
      key: "total",
      header: "합계",
      numeric: true,
      render: (application) => formatKrw(application.requested_total_budget_krw),
    },
    {
      key: "status",
      header: "상태",
      render: (application) => <ApplicationBadge status={application.status} />,
    },
  ];

  const pending = (applications ?? []).filter((a) => a.status === "submitted").length;

  return (
    <div className={styles.sections}>
      <PageHeader />

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      <section aria-labelledby="quarter-list">
        <h2 className="section-title" id="quarter-list">
          분기
          <span className={styles.sectionNote}>
            줄을 누르면 그 분기를 보고 있는 분기로 고릅니다
          </span>
        </h2>
        <AdminTable
          columns={quarterColumns}
          rows={quarters}
          rowKey={(quarter) => quarter.id}
          rowActions={(quarter) => (
            <RowMenu
              items={[
                {
                  label: "보고 있는 분기로",
                  disabled: quarter.id === quarterId,
                  onSelect: () => select(quarter.id),
                },
                {
                  label: quarter.status === "application_open" ? "신청 마감" : "신청 열기",
                  disabled: busy,
                  onSelect: () =>
                    setConfirm({
                      title:
                        quarter.status === "application_open"
                          ? `${quarter.display_name} 신청 마감`
                          : `${quarter.display_name} 신청 열기`,
                      effect:
                        quarter.status === "application_open"
                          ? "회원이 더 이상 이 분기에 신청할 수 없습니다. 이미 올라온 신청은 그대로 남아 심사할 수 있습니다."
                          : "회원이 Profile에서 이 분기에 신청할 수 있게 됩니다. Build/Video 비율은 회원이 정합니다.",
                      confirmLabel:
                        quarter.status === "application_open" ? "신청 마감" : "신청 열기",
                      onConfirm: () =>
                        run(
                          quarter.status === "application_open"
                            ? `${quarter.display_name}의 신청을 마감했습니다.`
                            : `${quarter.display_name}의 신청을 열었습니다.`,
                          () =>
                            updateQuarter(quarter.id, {
                              status:
                                quarter.status === "application_open"
                                  ? "closed"
                                  : "application_open",
                            }),
                        ),
                    }),
                },
              ]}
            />
          )}
          empty="아직 분기가 없습니다."
        />
        <p className="small dim" style={{ marginTop: "0.6rem" }}>
          분기를 새로 만드는 화면은 아직 없습니다. 지금은 백엔드의{" "}
          <code className="mono">POST /api/admin/quarters</code>로 만듭니다.
        </p>
      </section>

      {selected !== null && (
        <section aria-labelledby="quarter-applications">
          <h2 className="section-title" id="quarter-applications">
            {selected.display_name} 참여 신청
            <span className={styles.sectionNote}>
              전체 {applications?.length ?? 0} · 대기 {pending}
            </span>
          </h2>

          {applications === null ? (
            <p className="small muted">신청을 불러오는 중…</p>
          ) : (
            <>
              {applications.length > 0 && (
                <SearchBar
                  value={query}
                  onChange={setQuery}
                  placeholder="회원 이름이나 아이디로 검색"
                  resultCount={visibleApplications.length}
                  totalCount={applications.length}
                  filters={[
                    {
                      key: "status",
                      label: "상태",
                      value: statusFilter,
                      onChange: setStatusFilter,
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

              <AdminTable
                columns={applicationColumns}
                rows={visibleApplications}
                rowKey={(application) => application.id}
                rowHref={(application) =>
                  withQuarter(`/admin/members/${application.user_id}`, selected.id)
                }
                rowActions={(application) =>
                  application.status === "submitted" ? (
                    <RowMenu
                      items={[
                        {
                          label: "승인",
                          disabled: busy,
                          onSelect: () =>
                            setConfirm({
                              title: `참여 신청 승인 — ${application.display_name}`,
                              effect: `신청한 그대로 Build ${formatKrw(
                                application.requested_build_budget_krw,
                              )}, Video ${formatKrw(
                                application.requested_video_budget_krw,
                              )}의 지원금이 만들어지고, ${
                                application.display_name
                              }이(가) ${selected.display_name}에 참여하게 됩니다.`,
                              confirmLabel: "승인",
                              onConfirm: () =>
                                run(
                                  `${application.display_name}의 신청을 승인했습니다.`,
                                  () => reviewApplication(application.id, true),
                                ),
                            }),
                        },
                        {
                          label: "거절",
                          danger: true,
                          disabled: busy,
                          onSelect: () =>
                            setConfirm({
                              title: `참여 신청 거절 — ${application.display_name}`,
                              effect: `${application.display_name}은(는) ${selected.display_name}에 참여하지 못하고 지원금도 받지 못합니다. 신청은 다시 올릴 수 있습니다.`,
                              confirmLabel: "거절",
                              danger: true,
                              onConfirm: () =>
                                run(
                                  `${application.display_name}의 신청을 거절했습니다.`,
                                  () => reviewApplication(application.id, false),
                                ),
                            }),
                        },
                      ]}
                    />
                  ) : (
                    <span className="small dim">처리됨</span>
                  )
                }
                empty="아직 들어온 신청이 없습니다."
              />
            </>
          )}
        </section>
      )}

      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function PageHeader() {
  return (
    <header className="page-header page-header-stacked">
      <h1 className="page-title">분기 · 신청</h1>
      <p className="page-subtitle">
        분기마다 신청을 열고 닫습니다. 승인하면 신청한 금액 그대로 지원금이 만들어지고 참여
        기록도 함께 쓰입니다. 금액을 고치는 일은 회원 상세 화면에서 합니다.
      </p>
    </header>
  );
}
