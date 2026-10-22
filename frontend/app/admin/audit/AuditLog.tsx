"use client";

/**
 * Admin — 감사 로그 (/admin/audit). 읽기 전용.
 *
 * 관리자가 회원 자격이나 지원금을 바꿀 때마다 한 줄이 남습니다. 누가,
 * 무엇을, 언제 바꿨는지가 기록되고, 이 화면에서는 읽기만 할 수 있습니다.
 * 고칠 수 있는 기록은 기록이 아니기 때문에 수정·삭제 기능은 아예 두지
 * 않았습니다 — 백엔드에도 없습니다.
 *
 * 사용량 시뮬레이션은 없앴습니다(admin-and-nav-cleanup). 기록을 읽는 화면과 돈을
 * 쓰는 도구가 한 화면에 있을 이유가 없고, 시뮬레이터는 개발 환경에서만
 * 쓰입니다.
 */

import { useEffect, useMemo, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import Skeleton from "@/app/components/Skeleton";
import { formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { listAuditLog, type AuditEntry } from "@/lib/quarters";

import { DataTable, PanelBar, Stack, Tag } from "../components/AdminUI";

/** 한 번에 그리는 줄 수 — 더 보기로 늘립니다. */
const PAGE = 50;

export default function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE);

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
      matchesQuery(query, entry.summary, entry.actor_username, entry.action_label, entry.target_label) &&
      (actionFilter === "all" || entry.action === actionFilter),
  );
  const shown = visible.slice(0, limit);

  const search = (value: string) => {
    setQuery(value);
    setLimit(PAGE);
  };
  const filter = (value: string) => {
    setActionFilter(value);
    setLimit(PAGE);
  };

  if (error !== null) {
    return (
      <div className="card">
        <p className="small muted">기록을 불러오지 못했습니다. {error}.</p>
      </div>
    );
  }
  if (entries === null) return <Skeleton />;

  return (
    <Stack>
      <PanelBar
        left={
          entries.length > 0 ? (
            <SearchBar
              value={query}
              onChange={search}
              placeholder="내용, 관리자, 대상으로 검색"
              resultCount={visible.length}
              totalCount={entries.length}
              grow
              filters={[
                {
                  key: "action",
                  label: "작업",
                  value: actionFilter,
                  onChange: filter,
                  options: [
                    { value: "all", label: "전체" },
                    ...actionOptions.map(([value, label]) => ({ value, label })),
                  ],
                },
              ]}
            />
          ) : undefined
        }
        note={`읽기 전용 · ${entries.length.toLocaleString("ko-KR")}건`}
        help={
          <p>
            관리자가 회원 자격, 지원금, 설정을 바꾼 모든 기록이에요. 누가 · 무엇을 · 언제 바꿨는지 남고, 수정하거나 지울 수
            없어요 — 고칠 수 있는 기록은 기록이 아니니까요. 백엔드에도 수정·삭제가 없어요.
          </p>
        }
      />

      {visible.length === 0 ? (
        <div className="card">
          <p className="small muted">
            {entries.length === 0
              ? "아직 기록이 없습니다. 회원 참여 상태나 지원금을 바꾸면 여기에 남습니다."
              : "조건에 맞는 기록이 없습니다."}
          </p>
        </div>
      ) : (
        <DataTable testId="audit-table">
          <thead>
            <tr>
              <th scope="col">시각</th>
              <th scope="col">한 사람</th>
              <th scope="col">작업</th>
              <th scope="col">내용</th>
              <th scope="col">대상</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((entry) => (
              <tr key={entry.id}>
                <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatWhen(entry.created_at)}</td>
                <td style={{ whiteSpace: "nowrap" }}>@{entry.actor_username || "—"}</td>
                <td>
                  <Tag>{entry.action_label}</Tag>
                </td>
                <td>{entry.summary}</td>
                <td>{entry.target_label || "—"}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {visible.length > shown.length && (
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
          <button className="btn btn-sm" type="button" onClick={() => setLimit((value) => value + PAGE)}>
            더 보기
          </button>
          <span className="small dim">
            {shown.length} / {visible.length}건
          </span>
        </div>
      )}
    </Stack>
  );
}
