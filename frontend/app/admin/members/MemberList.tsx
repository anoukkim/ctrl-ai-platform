"use client";

/**
 * Admin — 회원 목록 (/admin/members)
 *
 * 찾는 화면입니다. 역할과 지원금처럼 그 사람을 보고 정해야 하는 일은
 * 상세 화면(`/admin/members/[id]`)에만 있습니다.
 *
 * 이전에는 줄마다 작은 버튼 세 개가 붙어 있었고, 잘못 누르면 그 자리에서
 * 남의 참여 상태가 바뀌었습니다. 지금은 "관리" 메뉴 하나이고, 고른 뒤
 * 확인창이 무슨 일이 생기는지 알려 줍니다.
 *
 * 거르기와 정렬은 브라우저 안에서 합니다. 백엔드가 분기의 전체 회원을 한
 * 번에 돌려주고, 동아리 규모에서는 그것이 수백 줄입니다. 수가 늘면 서버
 * 쪽으로 옮기면 되고, 그때 바뀌는 것은 이 파일 하나입니다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { ROLE_LABEL, getMemberStats, type MemberStats } from "@/lib/admin";
import { describeError } from "@/lib/http";
import {
  MEMBERSHIP_LABEL,
  listQuarterMembers,
  setQuarterMembership,
  type MemberWithMembership,
  type MembershipStatus,
} from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import AdminTable, { type Column } from "../components/AdminTable";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import StatCards from "../components/StatCards";
import ResultMessage, { type Result } from "../components/ResultMessage";
import RowMenu from "../components/RowMenu";
import { AccountBadge, MembershipBadge } from "../components/StatusBadge";

import styles from "../admin.module.css";

type SortKey = "name" | "role" | "account" | "membership";

/** 한 쪽에 보여 줄 줄 수. 넘치면 쪽을 나눕니다. */
const PAGE_SIZE = 25;

export default function MemberList() {
  const router = useRouter();
  const { selected, refresh: refreshDashboard } = useAdminQuarter();
  const quarterId = selected?.id ?? null;

  /**
   * 불러온 줄과 그 줄이 속한 분기를 함께 들고 있습니다.
   *
   * 분기를 바꿀 때 목록을 `null`로 되돌리는 대신 이렇게 둡니다. 효과
   * 본문에서 상태를 바로 바꾸면 그림이 연달아 다시 그려지고, 무엇보다
   * 지난 분기의 줄을 새 분기의 것처럼 잠깐 보여 주게 됩니다.
   */
  const [loaded, setLoaded] = useState<{
    quarterId: number;
    rows: MemberWithMembership[];
  } | null>(null);
  /** 카드의 숫자. 목록이 아니라 백엔드의 묶음 질의에서 옵니다 — 거르기를
   *  걸어 둔 채 세면 "전체"가 아니라 "보이는 것"을 세게 됩니다. */
  const [stats, setStats] = useState<MemberStats | null>(null);
  const members = loaded !== null && loaded.quarterId === quarterId ? loaded.rows : null;
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [membershipFilter, setMembershipFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [page, setPage] = useState(1);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (quarterId === null) return;
    let cancelled = false;

    Promise.all([listQuarterMembers(quarterId), getMemberStats(quarterId)])
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

  const visible = useMemo(() => {
    const rows = (members ?? []).filter(
      (member) =>
        matchesQuery(query, member.display_name, member.username) &&
        (roleFilter === "all" || member.role === roleFilter) &&
        (accountFilter === "all" || member.account_status === accountFilter) &&
        (membershipFilter === "all" ||
          (member.membership_status ?? "none") === membershipFilter),
    );

    const collator = new Intl.Collator("ko");
    return [...rows].sort((a, b) => {
      switch (sort) {
        case "role":
          return a.role === b.role ? collator.compare(a.display_name, b.display_name) : a.role < b.role ? -1 : 1;
        case "account":
          return a.account_status === b.account_status
            ? collator.compare(a.display_name, b.display_name)
            : a.account_status < b.account_status
              ? -1
              : 1;
        case "membership": {
          const rank = (status: string | null) =>
            status === "active" ? 0 : status === "inactive" ? 1 : status === "former" ? 2 : 3;
          const difference = rank(a.membership_status) - rank(b.membership_status);
          return difference !== 0 ? difference : collator.compare(a.display_name, b.display_name);
        }
        default:
          return collator.compare(a.display_name, b.display_name);
      }
    });
  }, [members, query, roleFilter, accountFilter, membershipFilter, sort]);

  /**
   * 참여 상태를 바꾸는 흐름: 확인 → 실행 → 결과 → 다시 읽기.
   *
   * 목록에서도 바꿀 수 있게 둔 이유는 열 명을 차례로 등록하는 일이
   * 분기 초에 실제로 있기 때문입니다. 다만 곧바로 반영되지는 않습니다 —
   * 메뉴에서 고른 뒤 확인창이 무슨 일이 생기는지 알려 줍니다.
   */
  const changeMembership = useCallback(
    async (member: MemberWithMembership, status: MembershipStatus) => {
      if (quarterId === null) return;
      setBusy(true);
      try {
        await setQuarterMembership(quarterId, member.user_id, status);
        setResult({
          kind: "ok",
          text: `${member.display_name}의 참여 상태를 ${MEMBERSHIP_LABEL[status]}(으)로 바꿨습니다.`,
        });
        const [rows, figures] = await Promise.all([
          listQuarterMembers(quarterId),
          getMemberStats(quarterId),
        ]);
        setLoaded({ quarterId, rows });
        setStats(figures);
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

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // 고른 쪽이 남은 쪽 수를 넘지 않게 자릅니다. 3쪽을 보던 중에 걸러서
  // 한 쪽만 남으면 빈 화면이 나오기 때문입니다. 효과로 1쪽으로 되돌리는
  // 대신 여기서 계산하면, 거르기를 지웠을 때 보던 쪽으로 돌아옵니다.
  const currentPage = Math.min(page, pageCount);
  const rows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (selected === null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">
            먼저 분기를 만들면 그 분기의 참여 상태를 관리할 수 있습니다.
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
          <p className="small muted">회원 목록을 불러오지 못했습니다. {error}.</p>
        </div>
      </>
    );
  }

  if (members === null) {
    return (
      <>
        <PageHeader />
        <p className="small muted">불러오는 중…</p>
      </>
    );
  }

  const columns: Column<MemberWithMembership>[] = [
    {
      key: "member",
      header: "회원",
      render: (member) => (
        <span className={styles.memberName}>
          {member.display_name}
          <span className={styles.memberHandle}>@{member.username}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "역할",
      render: (member) => (
        <span className={`badge ${member.role === "admin" ? "badge-accent" : "badge-muted"}`}>
          {ROLE_LABEL[member.role]}
        </span>
      ),
    },
    {
      key: "account",
      header: "계정",
      render: (member) => <AccountBadge status={member.account_status} />,
    },
    {
      key: "membership",
      header: `참여 (${selected.display_name})`,
      render: (member) => <MembershipBadge status={member.membership_status} />,
    },
  ];

  /**
   * 카드를 누르면 그에 맞는 거르기가 걸립니다.
   *
   * 카드마다 거르는 축이 다릅니다 — 활동/비활동은 참여 상태, 탈퇴는 계정
   * 상태, 관리자는 역할입니다. 한 번에 하나만 걸리게 하려고, 카드를 고를
   * 때 나머지 축은 전체로 되돌립니다. 그러지 않으면 "관리자"를 누른 뒤
   * "탈퇴"를 눌렀을 때 아무도 나오지 않고, 왜인지도 보이지 않습니다.
   */
  const activeCard =
    membershipFilter === "active"
      ? "active"
      : membershipFilter === "inactive"
        ? "inactive"
        : membershipFilter === "none"
          ? "not_applied"
          : accountFilter === "former"
            ? "former"
            : roleFilter === "admin"
              ? "admins"
              : null;

  function selectCard(key: string) {
    setRoleFilter("all");
    setAccountFilter(key === "former" ? "former" : "all");
    setMembershipFilter(
      key === "active"
        ? "active"
        : key === "inactive"
          ? "inactive"
          : key === "not_applied"
            ? "none"
            : "all",
    );
    if (key === "admins") setRoleFilter("admin");
    setPage(1);
  }

  return (
    <>
      <PageHeader note={`${selected.display_name} 기준`} />

      {stats !== null && (
        <StatCards
          active={activeCard}
          onSelect={selectCard}
          cards={[
            { key: "total", label: "전체 회원", value: stats.total, unit: "명" },
            { key: "active", label: "활동 회원", value: stats.active, unit: "명" },
            { key: "inactive", label: "비활동", value: stats.inactive, unit: "명" },
            {
              key: "not_applied",
              label: "미신청",
              value: stats.not_applied,
              unit: "명",
              accent: stats.not_applied > 0,
            },
            { key: "former", label: "탈퇴", value: stats.former, unit: "명" },
            { key: "admins", label: "관리자", value: stats.admins, unit: "명" },
          ]}
        />
      )}

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="이름이나 아이디로 검색"
        resultCount={visible.length}
        totalCount={members.length}
        filters={[
          {
            key: "role",
            label: "역할",
            value: roleFilter,
            onChange: setRoleFilter,
            options: [
              { value: "all", label: "전체" },
              { value: "admin", label: ROLE_LABEL.admin },
              { value: "member", label: ROLE_LABEL.member },
            ],
          },
          {
            key: "account",
            label: "계정",
            value: accountFilter,
            onChange: setAccountFilter,
            options: [
              { value: "all", label: "전체" },
              { value: "active", label: "사용 가능" },
              { value: "inactive", label: "비활동" },
              { value: "former", label: "탈퇴 회원" },
            ],
          },
          {
            key: "membership",
            label: "참여",
            value: membershipFilter,
            onChange: setMembershipFilter,
            options: [
              { value: "all", label: "전체" },
              ...Object.entries(MEMBERSHIP_LABEL).map(([value, label]) => ({ value, label })),
              { value: "none", label: "미참여" },
            ],
          },
          {
            key: "sort",
            label: "정렬",
            value: sort,
            onChange: (value) => setSort(value as SortKey),
            options: [
              { value: "name", label: "이름순" },
              { value: "role", label: "역할순" },
              { value: "account", label: "계정 상태순" },
              { value: "membership", label: "참여 상태순" },
            ],
          },
        ]}
      />

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      <AdminTable
        columns={columns}
        rows={rows}
        rowKey={(member) => member.user_id}
        rowHref={(member) => withQuarter(`/admin/members/${member.user_id}`, selected.id)}
        rowActions={(member) => (
          <RowMenu
            items={[
              {
                label: "상세 열기",
                onSelect: () =>
                  router.push(withQuarter(`/admin/members/${member.user_id}`, selected.id)),
              },
              {
                label: "참여 등록",
                disabled: busy || member.membership_status === "active",
                onSelect: () =>
                  setConfirm({
                    title: `참여 등록 — ${member.display_name}`,
                    effect: `${member.display_name}이(가) ${selected.display_name}에 참여하게 되고, 앱과 영상을 만들 수 있습니다.`,
                    confirmLabel: "참여 등록",
                    onConfirm: () => changeMembership(member, "active"),
                  }),
              },
              {
                label: "비활동으로",
                disabled: busy || member.membership_status === "inactive",
                onSelect: () =>
                  setConfirm({
                    title: `비활동으로 — ${member.display_name}`,
                    effect: `${member.display_name}은(는) 로그인과 조회는 되지만, ${selected.display_name}에 새로 만들 수 없습니다. 이미 만든 것은 그대로 남습니다.`,
                    confirmLabel: "비활동으로",
                    onConfirm: () => changeMembership(member, "inactive"),
                  }),
              },
              {
                label: "탈퇴 처리",
                danger: true,
                disabled: busy || member.membership_status === "former",
                onSelect: () =>
                  setConfirm({
                    title: `탈퇴 처리 — ${member.display_name}`,
                    effect: `탈퇴 처리하면 ${member.display_name}은(는) 로그인할 수 없습니다. 열려 있는 로그인도 다음 요청에서 끊깁니다. 게시한 작품에는 이름이 "탈퇴 회원"으로 계속 남습니다.`,
                    confirmLabel: "탈퇴 처리",
                    danger: true,
                    onConfirm: () => changeMembership(member, "former"),
                  }),
              },
            ]}
          />
        )}
        empty="조건에 맞는 회원이 없습니다."
      />

      {pageCount > 1 && (
        <nav aria-label="쪽 이동" className={styles.pager}>
          <button
            className="btn btn-sm"
            type="button"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            이전
          </button>
          <span className="small muted">
            {currentPage} / {pageCount} 쪽 · 전체 {visible.length}명
          </span>
          <button
            className="btn btn-sm"
            type="button"
            disabled={currentPage === pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            다음
          </button>
        </nav>
      )}

      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function PageHeader({ note }: { note?: string }) {
  return (
    <header className="page-header page-header-stacked">
      <h1 className="page-title">
        회원
        {note && <span className={styles.sectionNote}> {note}</span>}
      </h1>
      <p className="page-subtitle">
        카드를 눌러 걸러 보거나, 검색해서 찾습니다. 참여 상태는 줄의 관리 메뉴에서 바로
        바꿀 수 있고, 역할과 지원금은 그 사람을 보고 정해야 하므로 상세 화면에 있습니다.
      </p>
    </header>
  );
}
