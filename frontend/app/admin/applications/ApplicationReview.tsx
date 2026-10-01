"use client";

/**
 * Admin — 신청 승인 (/admin/applications)
 *
 * 관리자가 분기 중에 가장 자주 하는 일입니다. 그래서 자기 화면을 갖고,
 * 메뉴에서도 분기 설정보다 앞에 옵니다.
 *
 * 분기 표는 여기에 없습니다. 위쪽의 "보고 있는 분기"가 이미 분기를
 * 고르고 있고, 심사하러 온 사람에게 분기 목록은 읽어야 할 것이 하나 더
 * 있는 것일 뿐입니다. 분기를 바꾸는 일은 분기 설정에서 합니다.
 *
 * 승인과 거절은 줄 안의 버튼입니다. 메뉴를 한 번 더 여는 것은 열 건을
 * 연달아 처리할 때 스무 번의 추가 조작이 됩니다. 대신 두 버튼 모두
 * 확인창을 지나가고, 거절은 이유를 묻습니다 — 이유 없는 거절은 회원도
 * 나중에 보는 관리자도 설명할 수 없습니다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { formatWhen, getApplicationStats, type ApplicationStats } from "@/lib/admin";
import { describeError } from "@/lib/http";
import {
  APPLICATION_STATUS_LABEL,
  QUARTER_STATUS_LABEL,
  formatDate,
  formatKrw,
  listQuarterApplications,
  reviewApplication,
  type ApplicationStatus,
  type ApplicationWithMember,
} from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import AdminTable, { type Column } from "../components/AdminTable";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import ResultMessage, { type Result } from "../components/ResultMessage";
import StatCards from "../components/StatCards";
import { ApplicationBadge } from "../components/StatusBadge";

import styles from "../admin.module.css";

/** 상태 탭. 기본은 승인 대기 — 이 화면에 온 이유가 그것입니다. */
const TABS: { key: string; label: string; status: ApplicationStatus | null }[] = [
  { key: "submitted", label: "승인 대기", status: "submitted" },
  { key: "approved", label: "승인됨", status: "approved" },
  { key: "rejected", label: "거절됨", status: "rejected" },
  { key: "all", label: "전체", status: null },
];

/**
 * 신청 마감까지 며칠. 이미 지났으면 null입니다.
 *
 * 날짜끼리만 뺍니다. 시각까지 섞으면 어제 자정에 끝난 마감이 "D-0"으로
 * 보입니다 — 반올림이 음수를 0으로 만들기 때문입니다. 마감이 지난 것과
 * 오늘 마감인 것은 관리자에게 전혀 다른 소식입니다.
 */
function daysUntil(iso: string | null): number | null {
  if (iso === null) return null;

  const closes = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(closes.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Math.round((closes.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
}

export default function ApplicationReview() {
  const searchParams = useSearchParams();
  const { selected, refresh: refreshDashboard } = useAdminQuarter();
  const quarterId = selected?.id ?? null;

  const [loaded, setLoaded] = useState<{
    quarterId: number;
    rows: ApplicationWithMember[];
  } | null>(null);
  const [stats, setStats] = useState<ApplicationStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  // 대시보드의 "대기 중인 신청" 카드가 ?status=submitted 로 들어옵니다.
  const [tab, setTab] = useState<string>(() => {
    const asked = searchParams.get("status");
    return TABS.some((entry) => entry.key === asked) ? asked! : "submitted";
  });

  const applications = loaded !== null && loaded.quarterId === quarterId ? loaded.rows : null;

  const load = useCallback(async () => {
    if (quarterId === null) return;
    const [rows, figures] = await Promise.all([
      listQuarterApplications(quarterId),
      getApplicationStats(quarterId),
    ]);
    setLoaded({ quarterId, rows });
    setStats(figures);
  }, [quarterId]);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (quarterId === null) return;
    let cancelled = false;

    Promise.all([listQuarterApplications(quarterId), getApplicationStats(quarterId)])
      .then(([rows, figures]) => {
        if (cancelled) return;
        setLoaded({ quarterId, rows });
        setStats(figures);
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
        await load();
        await refreshDashboard();
      } catch (caught) {
        setResult({ kind: "error", text: describeError(caught) });
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [load, refreshDashboard],
  );

  const visible = useMemo(() => {
    const wanted = TABS.find((entry) => entry.key === tab)?.status ?? null;
    return (applications ?? []).filter(
      (application) =>
        (wanted === null || application.status === wanted) &&
        matchesQuery(query, application.display_name, application.username),
    );
  }, [applications, tab, query]);

  if (selected === null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">
            아직 분기가 없습니다.{" "}
            <Link href="/admin/quarters">분기 설정</Link>에서 분기를 먼저 만들어 주세요.
          </p>
        </div>
      </>
    );
  }

  if (error !== null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">신청을 불러오지 못했습니다. {error}.</p>
        </div>
      </>
    );
  }

  if (applications === null || stats === null) {
    return (
      <>
        <PageHeader />
        <p className="small muted">불러오는 중…</p>
      </>
    );
  }

  const deadline = daysUntil(selected.application_closes_at);

  const columns: Column<ApplicationWithMember>[] = [
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
        `${application.build_percentage}% · ${formatKrw(application.requested_build_budget_krw)}`,
    },
    {
      key: "video",
      header: "Video",
      numeric: true,
      render: (application) =>
        `${application.video_percentage}% · ${formatKrw(application.requested_video_budget_krw)}`,
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
      render: (application) =>
        application.status === "submitted" ? (
          <ApplicationBadge status={application.status} />
        ) : (
          // 처리된 줄은 누가 언제 정했는지까지 보여 줍니다. "처리됨"만
          // 적혀 있으면 두 번째 관리자가 가장 먼저 묻는 것 — 누가 정했나 —
          // 을 감사 로그까지 가서 찾아야 합니다.
          <span className={styles.stackCell}>
            <ApplicationBadge status={application.status} />
            <span className="small dim">
              {application.reviewed_by_display_name || "—"}
              {application.reviewed_at && ` · ${formatWhen(application.reviewed_at)}`}
            </span>
          </span>
        ),
    },
  ];

  const emptyText =
    tab === "submitted"
      ? "처리할 신청이 없습니다."
      : query
        ? "조건에 맞는 신청이 없습니다."
        : `${APPLICATION_STATUS_LABEL[TABS.find((e) => e.key === tab)?.status ?? "submitted"]} 신청이 없습니다.`;

  return (
    <div className={styles.sections}>
      <PageHeader />

      {/* 고른 분기 한 줄. 바꾸러 가는 길까지 함께 둡니다. */}
      <div className={styles.quarterLine}>
        <strong>{selected.display_name}</strong>
        <span className="badge badge-muted">{QUARTER_STATUS_LABEL[selected.status]}</span>
        <span className="small muted">
          신청 마감{" "}
          {selected.application_closes_at ? formatDate(selected.application_closes_at) : "미정"}
          {deadline !== null ? (
            <span className={styles.dday}>D-{deadline}</span>
          ) : (
            selected.application_closes_at && (
              <span className={styles.ddayPast}>마감됨</span>
            )
          )}
        </span>
        <span className="small muted">1인 한도 {formatKrw(selected.subsidy_limit_krw)}</span>
        <Link className={styles.quarterLineLink} href={withQuarter("/admin/quarters", selected.id)}>
          분기 설정에서 바꾸기 ›
        </Link>
      </div>

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      <StatCards
        active={tab === "all" ? null : tab}
        onSelect={(key) => setTab(key === "" ? "all" : key)}
        clearLabel="전체 보기"
        cards={[
          { key: "all", label: "전체 신청", value: stats.total, unit: "명" },
          {
            key: "submitted",
            label: "승인 대기",
            value: stats.pending,
            unit: "명",
            accent: stats.pending > 0,
          },
          { key: "approved", label: "승인", value: stats.approved, unit: "명" },
          { key: "rejected", label: "거절", value: stats.rejected, unit: "명" },
          {
            key: "amount",
            label: "신청 금액 합계",
            value: formatKrw(stats.requested_total_krw),
          },
        ]}
      />

      <div className={styles.statusTabs} role="tablist" aria-label="신청 상태">
        {TABS.map((entry) => {
          const count =
            entry.status === null
              ? stats.total
              : entry.status === "submitted"
                ? stats.pending
                : entry.status === "approved"
                  ? stats.approved
                  : stats.rejected;

          return (
            <button
              className={`${styles.statusTab} ${tab === entry.key ? styles.statusTabActive : ""}`}
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
              <span className={styles.statusTabCount}>{count}</span>
            </button>
          );
        })}
      </div>

      {applications.length > 0 && (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="회원 이름이나 아이디로 검색"
          resultCount={visible.length}
          totalCount={applications.length}
        />
      )}

      {visible.length === 0 && tab === "submitted" ? (
        <div className="card">
          <p className="small muted">처리할 신청이 없습니다.</p>
          <p style={{ marginTop: "0.7rem" }}>
            <button className="btn btn-sm" type="button" onClick={() => setTab("approved")}>
              승인됨 {stats.approved}건 보기
            </button>
          </p>
        </div>
      ) : (
        <AdminTable
          columns={columns}
          rows={visible}
          rowKey={(application) => application.id}
          rowHref={(application) =>
            withQuarter(`/admin/members/${application.user_id}`, selected.id)
          }
          rowMuted={(application) => application.status !== "submitted"}
          rowActions={(application) =>
            application.status === "submitted" ? (
              <span className={styles.rowButtons}>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: `참여 신청 승인 — ${application.display_name}`,
                      effect: `신청한 그대로 Build ${formatKrw(
                        application.requested_build_budget_krw,
                      )}, Video ${formatKrw(
                        application.requested_video_budget_krw,
                      )}의 지원금이 만들어지고, ${application.display_name}이(가) ${
                        selected.display_name
                      }에 참여하게 됩니다.`,
                      confirmLabel: "승인",
                      onConfirm: () =>
                        run(`${application.display_name}의 신청을 승인했습니다.`, () =>
                          reviewApplication(application.id, true),
                        ),
                    })
                  }
                >
                  승인
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: `참여 신청 거절 — ${application.display_name}`,
                      effect: `${application.display_name}은(는) ${selected.display_name}에 참여하지 못하고 지원금도 받지 못합니다. 신청은 다시 올릴 수 있습니다.`,
                      confirmLabel: "거절",
                      danger: true,
                      // 거절에는 이유를 받습니다. 이유 없는 거절은 회원도,
                      // 나중에 기록을 보는 관리자도 설명할 수 없습니다.
                      reason: {
                        label: "거절 사유",
                        placeholder: "예: 이번 분기 예산이 모두 배정되었습니다.",
                        required: true,
                      },
                      onConfirm: (reason) =>
                        run(`${application.display_name}의 신청을 거절했습니다.`, () =>
                          reviewApplication(application.id, false, reason),
                        ),
                    })
                  }
                >
                  거절
                </button>
              </span>
            ) : null
          }
          empty={emptyText}
        />
      )}

      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function PageHeader() {
  return (
    <header className="page-header page-header-stacked">
      <h1 className="page-title">신청 승인</h1>
      <p className="page-subtitle">
        승인하면 신청한 금액 그대로 지원금이 만들어지고 참여 기록도 함께 쓰입니다. 금액을
        고치는 일은 회원 상세 화면에서 합니다.
      </p>
    </header>
  );
}
