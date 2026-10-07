"use client";

/**
 * Admin — 삭제된 작업물 (/admin/deleted)
 *
 * 회원이 "삭제"를 누르면 행은 사라지지 않고 `deleted_at`만 찍힙니다.
 * 회원 쪽에서는 모든 경로가 404로 답하므로 지워진 것과 똑같이
 * 동작하지만, 그 행이 남아 있다는 사실에는 **되살릴 수 있는 곳이
 * 있어야 한다**는 조건이 붙습니다. 되살릴 수 없는 soft delete는 회원을
 * 속이면서 데이터베이스만 키우는 셈입니다. 이 화면이 그 자리입니다.
 *
 * 분기와 상관없는 목록입니다. 작업물은 분기에 묶이지 않고 회원에게
 * 속하므로, 보고 있는 분기를 바꿔도 이 목록은 그대로입니다 — 충전
 * 신청과 같은 이유입니다.
 *
 * 두 제품을 한 표에 섞습니다. 되살리려는 관리자는 그것이 Builder에서
 * 왔는지 Video에서 왔는지보다, 누구의 것이고 언제 사라졌는지를 봅니다.
 */

import { useCallback, useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import {
  WORK_KIND_LABEL,
  listDeletedItems,
  restoreWork,
  type DeletedItem,
} from "@/lib/projects";

import AdminTable, { type Column } from "../components/AdminTable";
import ResultMessage, { type Result } from "../components/ResultMessage";
import RowMenu from "../components/RowMenu";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";
import SharedPageHeader from "@/app/components/PageHeader";

export default function DeletedWorkAdmin() {
  const [items, setItems] = useState<DeletedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");

  const load = useCallback(async () => {
    setItems(await listDeletedItems());
  }, []);

  useEffect(() => {
    let cancelled = false;

    listDeletedItems()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const restore = useCallback(
    async (item: DeletedItem) => {
      setBusy(true);
      try {
        await restoreWork(item.kind, item.id);
        setResult({
          kind: "ok",
          text: `${item.owner_display_name}의 ${WORK_KIND_LABEL[item.kind]} '${item.name}'을 되살렸습니다.`,
        });
        await load();
      } catch (caught) {
        setResult({ kind: "error", text: describeError(caught) });
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [load],
  );

  if (error !== null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">삭제된 작업물을 불러오지 못했습니다. {error}.</p>
        </div>
      </>
    );
  }

  if (items === null) {
    return (
      <>
        <PageHeader />
        <p className="small muted">불러오는 중…</p>
      </>
    );
  }

  const visible = items.filter(
    (item) =>
      matchesQuery(query, item.name, item.owner_display_name, item.owner_username) &&
      (kindFilter === "all" || item.kind === kindFilter),
  );

  const columns: Column<DeletedItem>[] = [
    {
      key: "name",
      header: "이름",
      render: (item) => item.name,
    },
    {
      key: "kind",
      header: "종류",
      render: (item) => <span className="badge badge-muted">{WORK_KIND_LABEL[item.kind]}</span>,
    },
    {
      key: "owner",
      header: "만든 회원",
      render: (item) => (
        <span className={styles.memberName}>
          {item.owner_display_name}
          <span className={styles.memberHandle}>@{item.owner_username}</span>
        </span>
      ),
    },
    {
      key: "deleted",
      header: "삭제된 때",
      numeric: true,
      render: (item) => formatWhen(item.deleted_at),
    },
  ];

  return (
    <div className={styles.sections}>
      <PageHeader />

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      {items.length > 0 && (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="작업물 이름이나 회원으로 검색"
          resultCount={visible.length}
          totalCount={items.length}
          filters={[
            {
              key: "kind",
              label: "종류",
              value: kindFilter,
              onChange: setKindFilter,
              options: [
                { value: "all", label: "전체" },
                ...Object.entries(WORK_KIND_LABEL).map(([value, label]) => ({ value, label })),
              ],
            },
          ]}
        />
      )}

      <AdminTable
        columns={columns}
        rows={visible}
        rowKey={(item) => `${item.kind}-${item.id}`}
        rowHref={(item) => `/admin/members/${item.owner_user_id}`}
        rowActions={(item) => (
          <RowMenu
            items={[
              {
                label: "되살리기",
                disabled: busy,
                onSelect: () =>
                  setConfirm({
                    title: `되살리기 — ${item.name}`,
                    effect: `${item.owner_display_name}의 ${WORK_KIND_LABEL[item.kind]} '${item.name}'이 다시 보이게 됩니다. 회원은 다음 요청부터 목록에서 볼 수 있습니다.`,
                    confirmLabel: "되살리기",
                    onConfirm: () => restore(item),
                  }),
              },
            ]}
          />
        )}
        empty={
          items.length === 0
            ? "삭제된 작업물이 없습니다."
            : "조건에 맞는 작업물이 없습니다."
        }
      />

      <p className="small dim" style={{ marginTop: "0.6rem" }}>
        삭제된 작업물은 지워지지 않고 보관됩니다. 사용량 기록과 지원금 내역은 삭제와 무관하게
        그대로 남습니다 — 이미 쓴 돈은 되돌려지지 않습니다.
      </p>

      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function PageHeader() {
  return (
    <SharedPageHeader
      eyebrow="Admin"
      title={sectionLabel("deleted")}
      subtitle={
        <>
          회원이 삭제한 프로젝트와 영상입니다. 행은 지워지지 않으므로 잘못 지운 것을 되살릴 수
          있습니다.
        </>
      }
    />
  );
}
