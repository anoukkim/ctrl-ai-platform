"use client";

/**
 * Admin — 개인 충전 신청 (/admin/topups)
 *
 * 회원이 자기 돈을 충전해 달라고 올린 신청입니다. 결제 서비스는 붙이지
 * 않았으므로 관리자가 입금을 직접 확인합니다.
 *
 * 분기 화면에서 떼어 낸 이유: 개인 돈은 동아리 지원금이 아니고, 둘을 한
 * 화면에 두면 더해서 읽게 됩니다 (CLAUDE.md 9절 — 두 금액은 절대 합치지
 * 않습니다).
 *
 * 분기와 상관없는 목록입니다. 충전은 분기에 묶이지 않고 회원의 지갑에
 * 들어가기 때문에, 보고 있는 분기를 바꿔도 이 목록은 그대로입니다.
 */

import { useCallback, useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { TOP_UP_STATUS_LABEL, formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import {
  confirmTopUp,
  formatKrw,
  listAllTopUps,
  listQuarterMembers,
  type MemberWithMembership,
  type TopUp,
} from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import AdminTable, { type Column } from "../components/AdminTable";
import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import ResultMessage, { type Result } from "../components/ResultMessage";
import RowMenu from "../components/RowMenu";
import { TopUpBadge } from "../components/StatusBadge";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";
import SharedPageHeader from "@/app/components/PageHeader";

export default function TopUpAdmin() {
  const { selected, refresh: refreshDashboard } = useAdminQuarter();

  const [topUps, setTopUps] = useState<TopUp[] | null>(null);
  /** 아이디만으로는 누구인지 알 수 없어 이름을 함께 보여 줍니다. */
  const [members, setMembers] = useState<Map<number, MemberWithMembership>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("requested");

  const quarterId = selected?.id ?? null;

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listAllTopUps()
      .then((rows) => {
        if (!cancelled) setTopUps(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 회원 이름. 실패해도 목록은 보여 줍니다 — 이름이 없을 뿐입니다.
  useEffect(() => {
    if (quarterId === null) return;
    let cancelled = false;

    listQuarterMembers(quarterId)
      .then((rows) => {
        if (!cancelled) setMembers(new Map(rows.map((row) => [row.user_id, row])));
      })
      .catch(() => {
        /* 이름 없이 아이디만 보여 줍니다 */
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
        setTopUps(await listAllTopUps());
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

  function nameOf(userId: number): string {
    return members.get(userId)?.display_name ?? `회원 #${userId}`;
  }

  if (error !== null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">충전 신청을 불러오지 못했습니다. {error}.</p>
        </div>
      </>
    );
  }

  if (topUps === null) {
    return (
      <>
        <PageHeader />
        <p className="small muted">불러오는 중…</p>
      </>
    );
  }

  const visible = topUps.filter(
    (topUp) =>
      matchesQuery(query, nameOf(topUp.user_id), members.get(topUp.user_id)?.username ?? "") &&
      (statusFilter === "all" || topUp.status === statusFilter),
  );

  const columns: Column<TopUp>[] = [
    {
      key: "member",
      header: "회원",
      render: (topUp) => (
        <span className={styles.memberName}>
          {nameOf(topUp.user_id)}
          <span className={styles.memberHandle}>
            {members.get(topUp.user_id) ? `@${members.get(topUp.user_id)!.username}` : "—"}
          </span>
        </span>
      ),
    },
    {
      key: "amount",
      header: "금액",
      numeric: true,
      render: (topUp) => formatKrw(topUp.amount_krw),
    },
    {
      key: "status",
      header: "상태",
      render: (topUp) => <TopUpBadge status={topUp.status} />,
    },
    {
      key: "requested",
      header: "신청",
      numeric: true,
      render: (topUp) => (topUp.requested_at ? formatWhen(topUp.requested_at) : "—"),
    },
    {
      key: "reference",
      header: "입금 참조",
      render: (topUp) => topUp.payment_reference || "—",
    },
  ];

  return (
    <div className={styles.sections}>
      <PageHeader />

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      {topUps.length > 0 && (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="회원 이름이나 아이디로 검색"
          resultCount={visible.length}
          totalCount={topUps.length}
          filters={[
            {
              key: "status",
              label: "상태",
              value: statusFilter,
              onChange: setStatusFilter,
              options: [
                { value: "all", label: "전체" },
                ...Object.entries(TOP_UP_STATUS_LABEL).map(([value, label]) => ({
                  value,
                  label,
                })),
              ],
            },
          ]}
        />
      )}

      <AdminTable
        columns={columns}
        rows={visible}
        rowKey={(topUp) => topUp.id}
        rowHref={(topUp) => withQuarter(`/admin/members/${topUp.user_id}`, quarterId)}
        rowActions={(topUp) =>
          topUp.status === "requested" ? (
            <RowMenu
              items={[
                {
                  label: "입금 확인",
                  disabled: busy,
                  onSelect: () =>
                    setConfirm({
                      title: `입금 확인 — ${nameOf(topUp.user_id)}`,
                      effect: `${nameOf(topUp.user_id)}의 개인 잔액이 ${formatKrw(
                        topUp.amount_krw,
                      )} 늘어납니다. 개인 잔액은 동아리 지원금과 별개이고, 회원이 개인 잔액 사용을 켜 두었을 때만 쓰입니다.`,
                      confirmLabel: "입금 확인",
                      onConfirm: () =>
                        run(
                          `${nameOf(topUp.user_id)}의 ${formatKrw(
                            topUp.amount_krw,
                          )} 충전을 확인했습니다.`,
                          () => confirmTopUp(topUp.id, true, "관리자 확인"),
                        ),
                    }),
                },
                {
                  label: "거절",
                  danger: true,
                  disabled: busy,
                  onSelect: () =>
                    setConfirm({
                      title: `충전 거절 — ${nameOf(topUp.user_id)}`,
                      effect: `${nameOf(
                        topUp.user_id,
                      )}의 개인 잔액은 늘어나지 않습니다. 회원은 다시 신청할 수 있습니다.`,
                      confirmLabel: "거절",
                      danger: true,
                      onConfirm: () =>
                        run(`${nameOf(topUp.user_id)}의 충전 신청을 거절했습니다.`, () =>
                          confirmTopUp(topUp.id, false),
                        ),
                    }),
                },
              ]}
            />
          ) : (
            <span className="small dim">처리됨</span>
          )
        }
        empty={
          statusFilter === "requested"
            ? "확인할 충전 신청이 없습니다."
            : "조건에 맞는 충전 신청이 없습니다."
        }
      />

      <p className="small dim" style={{ marginTop: "0.6rem" }}>
        결제 서비스는 연결하지 않았습니다. 입금은 관리자가 직접 확인합니다.
      </p>

      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function PageHeader() {
  return (
    <SharedPageHeader
      eyebrow="Admin"
      title={sectionLabel("topups")}
      subtitle={
        <>
          회원이 올린 개인 충전 신청입니다. 개인 돈은 동아리 지원금과 별개로 관리하며 서로
          더하지 않습니다.
        </>
      }
    />
  );
}
