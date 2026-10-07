"use client";

/**
 * Admin — 분기 설정 (/admin/quarters)
 *
 * 분기를 만들고, 신청을 열고 닫습니다. 신청 심사는 /admin/applications로
 * 떼어 냈습니다 — 심사가 훨씬 자주 하는 일인데, 그 위에 분기 표가 얹혀
 * 있으면 매번 지나쳐야 하는 벽이 됩니다.
 *
 * 표에 숫자를 함께 보여 주는 이유: 분기를 비교할 수 있어야 합니다.
 * "참여 회원 12명에 실제 사용자 3명"은 다음 분기에 무엇을 바꿔야 하는지
 * 말해 주지만, 분기 이름과 기간만으로는 아무것도 알 수 없습니다.
 *
 * 숫자는 전부 백엔드의 묶음 질의에서 옵니다(`/admin/quarters-with-stats`).
 * 분기마다 질의를 한 번씩 돌리면 표가 길어질수록 느려집니다.
 */

import { useCallback, useEffect, useState } from "react";

import {
  createQuarter,
  listQuartersWithStats,
  type QuarterWithStats,
} from "@/lib/admin";
import { describeError } from "@/lib/http";
import { formatDate, formatKrw, updateQuarter } from "@/lib/quarters";

import { useAdminQuarter } from "../AdminQuarterProvider";
import AdminTable, { type Column } from "../components/AdminTable";
import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import ResultMessage, { type Result } from "../components/ResultMessage";
import RowMenu from "../components/RowMenu";
import { QuarterBadge } from "../components/StatusBadge";
import { sectionLabel } from "../sections";

import QuarterForm from "./QuarterForm";

import styles from "../admin.module.css";
import SharedPageHeader from "@/app/components/PageHeader";

export default function QuarterAdmin() {
  const { selected, select, refresh: refreshDashboard } = useAdminQuarter();

  const [quarters, setQuarters] = useState<QuarterWithStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listQuartersWithStats()
      .then((rows) => {
        if (!cancelled) setQuarters(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (succeeded: string, action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        setResult({ kind: "ok", text: succeeded });
        setQuarters(await listQuartersWithStats());
        await refreshDashboard();
      } catch (caught) {
        setResult({ kind: "error", text: describeError(caught) });
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [refreshDashboard],
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

  const columns: Column<QuarterWithStats>[] = [
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
          : "–",
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
    {
      key: "applicants",
      header: "신청자",
      numeric: true,
      render: (quarter) => quarter.stats.applicants || "–",
    },
    {
      key: "pending",
      header: "승인 대기",
      numeric: true,
      render: (quarter) =>
        quarter.stats.pending > 0 ? (
          <span className={styles.pendingNumber}>{quarter.stats.pending}</span>
        ) : (
          "–"
        ),
    },
    {
      key: "participants",
      header: "참여 회원",
      numeric: true,
      render: (quarter) => quarter.stats.participants || "–",
    },
    {
      key: "users",
      header: "실제 사용자",
      numeric: true,
      render: (quarter) =>
        // 아직 시작하지 않은 분기는 0명이 아니라 셀 것이 없습니다.
        quarter.stats.participants === 0 ? "–" : quarter.stats.users_with_usage,
    },
    {
      key: "rate",
      header: "사용률",
      numeric: true,
      // 참여 회원이 0이면 백엔드가 null을 줍니다. 0%가 아니라 "–" — 아무도
      // 참여하지 않은 분기에 사용률은 없습니다.
      render: (quarter) =>
        quarter.stats.usage_rate === null
          ? "–"
          : `${Math.round(quarter.stats.usage_rate * 100)}%`,
    },
  ];

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
          columns={columns}
          rows={quarters}
          rowKey={(quarter) => quarter.id}
          rowMuted={(quarter) => quarter.status === "closed"}
          rowActions={(quarter) => (
            <RowMenu
              items={[
                {
                  label: "보고 있는 분기로",
                  disabled: quarter.id === selected?.id,
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
          empty="아직 분기가 없습니다. 아래에서 첫 분기를 만들어 주세요."
        />

        <p className="small dim" style={{ marginTop: "0.6rem" }}>
          실제 사용자는 그 분기에 한 번이라도 예산을 쓴 회원 수입니다. 같은 회원이 여러 번
          썼더라도 한 명으로 셉니다. 사용률은 실제 사용자 ÷ 참여 회원입니다.
        </p>
      </section>

      <section aria-labelledby="quarter-new">
        <h2 className="section-title" id="quarter-new">
          새 분기 만들기
        </h2>

        {formOpen ? (
          <QuarterForm
            busy={busy}
            onCancel={() => setFormOpen(false)}
            onSubmit={(input, summary) =>
              setConfirm({
                title: "새 분기 만들기",
                effect: summary,
                confirmLabel: "분기 만들기",
                onConfirm: () =>
                  run(`${input.display_name} 분기를 만들었습니다.`, async () => {
                    await createQuarter(input);
                    setFormOpen(false);
                  }),
              })
            }
          />
        ) : (
          <div className="card">
            <p className="small muted">
              분기는 준비 상태로 만들어집니다. 회원이 신청할 수 있게 하려면 만든 뒤 위
              표에서 신청을 열어 주세요.
            </p>
            <p style={{ marginTop: "0.7rem" }}>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => setFormOpen(true)}
              >
                새 분기 만들기
              </button>
            </p>
          </div>
        )}
      </section>

      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function PageHeader() {
  return (
    <SharedPageHeader
      eyebrow="Admin"
      title={sectionLabel("quarters")}
      subtitle={
        <>
          분기를 만들고 신청을 열고 닫습니다. 올라온 신청을 심사하는 일은 Applications 화면에서
          합니다.
        </>
      }
    />
  );
}
