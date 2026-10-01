"use client";

/**
 * Admin — 감사 로그 (/admin/audit). 읽기 전용.
 *
 * 관리자가 회원 자격이나 지원금을 바꿀 때마다 한 줄이 남습니다. 누가,
 * 무엇을, 언제 바꿨는지가 기록되고, 이 화면에서는 읽기만 할 수 있습니다.
 * 고칠 수 있는 기록은 기록이 아니기 때문에 수정·삭제 기능은 아예 두지
 * 않았습니다 — 백엔드에도 없습니다.
 *
 * 사용량 시뮬레이션은 /admin/dev로 옮겼습니다. 기록을 읽는 화면과 돈을
 * 쓰는 도구가 한 화면에 있을 이유가 없고, 시뮬레이터는 개발 환경에서만
 * 쓰입니다.
 */

import { useEffect, useMemo, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { listAuditLog, type AuditEntry } from "@/lib/quarters";

import AdminTable, { type Column } from "../components/AdminTable";

import styles from "../admin.module.css";

export default function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listAuditLog()
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 실제로 기록에 있는 작업만 거르기 목록에 올립니다. 쓰이지 않은 작업이
  // 목록에 있으면 고를 때마다 빈 화면이 나옵니다.
  const actionOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries ?? []) seen.set(entry.action, entry.action_label);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
  }, [entries]);

  const visible = (entries ?? []).filter(
    (entry) =>
      matchesQuery(
        query,
        entry.summary,
        entry.actor_username,
        entry.action_label,
        entry.target_label,
      ) && (actionFilter === "all" || entry.action === actionFilter),
  );

  const columns: Column<AuditEntry>[] = [
    {
      key: "when",
      header: "시각",
      numeric: true,
      render: (entry) => formatWhen(entry.created_at),
    },
    {
      key: "actor",
      header: "한 사람",
      render: (entry) => (
        <span className={styles.memberHandle}>@{entry.actor_username || "—"}</span>
      ),
    },
    {
      key: "action",
      header: "작업",
      render: (entry) => <span className="badge badge-muted">{entry.action_label}</span>,
    },
    { key: "summary", header: "내용", render: (entry) => entry.summary },
    {
      key: "target",
      header: "대상",
      render: (entry) => entry.target_label || "—",
    },
  ];

  return (
    <div className={styles.sections}>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">감사 로그</h1>
        <p className="page-subtitle">
          관리자가 회원 자격이나 지원금을 바꾼 모든 기록입니다. 읽기 전용이며 수정하거나
          지울 수 없습니다 — 고칠 수 있는 기록은 기록이 아닙니다.
        </p>
      </header>

      {error !== null && (
        <div className="card">
          <p className="small muted">감사 로그를 불러오지 못했습니다. {error}.</p>
        </div>
      )}

      {error === null && entries === null && <p className="small muted">불러오는 중…</p>}

      {error === null && entries !== null && (
        <>
          {entries.length > 0 && (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="내용, 관리자, 대상으로 검색"
              resultCount={visible.length}
              totalCount={entries.length}
              filters={[
                {
                  key: "action",
                  label: "작업",
                  value: actionFilter,
                  onChange: setActionFilter,
                  options: [
                    { value: "all", label: "전체" },
                    ...actionOptions.map(([value, label]) => ({ value, label })),
                  ],
                },
              ]}
            />
          )}

          <AdminTable
            columns={columns}
            rows={visible}
            rowKey={(entry) => entry.id}
            empty={
              entries.length === 0
                ? "아직 기록이 없습니다. 회원 참여 상태나 지원금을 바꾸면 여기에 남습니다."
                : "조건에 맞는 기록이 없습니다."
            }
          />
        </>
      )}
    </div>
  );
}
