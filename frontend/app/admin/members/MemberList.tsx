"use client";

/**
 * Admin — 회원 목록 (/admin/members)
 *
 * admin-consolidation v3 (2): 참여 신청이 이 목록 안으로 들어왔어요 — 칩
 * 전체 · 승인 대기 · 활동 · 미참여, 승인 대기 줄에서 바로 승인/거절, 사용률
 * 열(80% 이상은 주황), 초대 코드는 칩 뒤에. 줄을 누르면 오른쪽에 회원
 * 상세가 열리고(`?member=`), 모든 일을 거기서 해요.
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
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { describeError } from "@/lib/http";
import {
  MEMBERSHIP_LABEL,
  formatKrw,
  listQuarterMembers,
  reviewApplication,
  setQuarterMembership,
  usedPct,
  type MemberWithMembership,
  type MembershipStatus,
} from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import AdminTable, { type Column } from "../components/AdminTable";
import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import InviteCodePanel from "./InviteCodePanel";
import MemberPanel from "./MemberPanel";
import ResultMessage, { type Result } from "../components/ResultMessage";
import RowMenu from "../components/RowMenu";
import { MembershipBadge } from "../components/StatusBadge";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";
import SharedPageHeader from "@/app/components/PageHeader";
import Skeleton from "@/app/components/Skeleton";

type SortKey = "name" | "usage" | "membership";
/** The list's chips (v3): one at a time. */
type Chip = "all" | "pending" | "active" | "none" | "invites";

/** 승인 대기: an application waits and no participation yet. */
function isPending(member: MemberWithMembership): boolean {
  return Boolean(member.application_id) && member.membership_status === null;
}

/** 미참여: not taking part this quarter (no row, or not active), not former. */
function isOut(member: MemberWithMembership): boolean {
  return member.account_status !== "former" && member.membership_status !== "active" && !isPending(member);
}

/** 사용률 at which the bar turns amber (the Dashboard alert's 80%). */
const USAGE_WARN_PCT = 80;

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
  const members = loaded !== null && loaded.quarterId === quarterId ? loaded.rows : null;
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const params = useSearchParams();
  const pathname = usePathname();
  // A link to 승인 대기 (the Dashboard, the old /admin/applications) opens that chip.
  const [chip, setChip] = useState<Chip>(() =>
    params.get("filter") === "pending" || params.get("status") === "submitted" ? "pending" : "all",
  );
  const [sort, setSort] = useState<SortKey>("name");
  const openMember = params.get("member");
  const [page, setPage] = useState(1);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (quarterId === null) return;
    let cancelled = false;

    listQuarterMembers(quarterId)
      .then((rows) => {
        if (cancelled) return;
        setLoaded({ quarterId, rows });
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
        (chip === "all" ||
          chip === "invites" ||
          (chip === "pending" && isPending(member)) ||
          (chip === "active" && member.membership_status === "active") ||
          (chip === "none" && isOut(member))),
    );

    const collator = new Intl.Collator("ko");
    return [...rows].sort((a, b) => {
      switch (sort) {
        case "usage":
          return (usedPct(b) ?? -1) - (usedPct(a) ?? -1) || collator.compare(a.display_name, b.display_name);
        case "membership": {
          const rank = (member: MemberWithMembership) =>
            isPending(member) ? -1 : member.membership_status === "active" ? 0 : member.membership_status === "inactive" ? 1 : member.membership_status === "former" ? 2 : 3;
          const difference = rank(a) - rank(b);
          return difference !== 0 ? difference : collator.compare(a.display_name, b.display_name);
        }
        default:
          return collator.compare(a.display_name, b.display_name);
      }
    });
  }, [members, query, chip, sort]);

  const counts = useMemo(() => {
    const all = members ?? [];
    return {
      all: all.length,
      pending: all.filter(isPending).length,
      active: all.filter((member) => member.membership_status === "active").length,
      none: all.filter(isOut).length,
    };
  }, [members]);

  /** The member panel opens by the address, so a link can open it too. */
  const memberHref = (userId: number | null) => {
    const next = new URLSearchParams(params.toString());
    if (userId === null) next.delete("member");
    else next.set("member", String(userId));
    const query = next.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  };

  const reload = useCallback(async () => {
    if (quarterId === null) return;
    setLoaded({ quarterId, rows: await listQuarterMembers(quarterId) });
    await refreshDashboard();
  }, [quarterId, refreshDashboard]);

  /** 승인/거절 in the row (the former Applications screen's two buttons). */
  const review = useCallback(
    async (member: MemberWithMembership, approve: boolean, reason = "") => {
      if (!member.application_id) return;
      setBusy(true);
      try {
        await reviewApplication(member.application_id, approve, reason);
        setResult({
          kind: "ok",
          text: approve ? `${member.display_name}의 신청을 승인했습니다.` : `${member.display_name}의 신청을 거절했습니다.`,
        });
        await reload();
      } catch (caught) {
        setResult({ kind: "error", text: describeError(caught) });
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [reload],
  );

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
        await reload();
      } catch (caught) {
        setResult({ kind: "error", text: describeError(caught) });
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [quarterId, reload],
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
        <Skeleton />
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
          {member.role === "admin" && <span className="badge badge-accent" style={{ marginLeft: "0.4rem" }}>관리자</span>}
        </span>
      ),
    },
    {
      key: "membership",
      header: "상태",
      render: (member) =>
        isPending(member) ? <span className="badge badge-warn">승인 대기</span> : <MembershipBadge status={member.membership_status} />,
    },
    {
      key: "usage",
      header: "사용률",
      numeric: true,
      render: (member) => {
        const pct = usedPct(member);
        if (pct === null) return <span className="small dim">—</span>;
        return (
          <span className={styles.usageCell} data-warn={pct >= USAGE_WARN_PCT ? "true" : undefined}>
            <span className={styles.usageBar} aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
            {pct}%
          </span>
        );
      },
    },
    {
      key: "left",
      header: "남음",
      numeric: true,
      render: (member) =>
        member.budget_krw ? formatKrw(Math.max(0, member.budget_krw - (member.consumed_krw ?? 0))) : <span className="small dim">—</span>,
    },
  ];

  const chips: { key: Chip; label: string; count?: number }[] = [
    { key: "all", label: "전체", count: counts.all },
    { key: "pending", label: "승인 대기", count: counts.pending },
    { key: "active", label: "활동", count: counts.active },
    { key: "none", label: "미참여", count: counts.none },
    { key: "invites", label: "초대 코드" },
  ];

  return (
    <>
      <PageHeader note={`${selected.display_name} 기준`} />

      <div className={styles.chipRow} role="group" aria-label="회원 거르기">
        {chips.map((item) => (
          <button
            key={item.key}
            type="button"
            className={styles.subTab + (chip === item.key ? ` ${styles.subTabActive}` : "")}
            aria-pressed={chip === item.key}
            onClick={() => {
              setChip(item.key);
              setPage(1);
            }}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={item.key === "pending" && item.count > 0 ? styles.tabCount : styles.chipCount}>{item.count}</span>
            )}
          </button>
        ))}
      </div>

      {chip === "invites" ? (
        <InviteCodePanel />
      ) : (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="이름이나 아이디로 검색"
          resultCount={visible.length}
          totalCount={members.length}
          filters={[
            {
              key: "sort",
              label: "정렬",
              value: sort,
              onChange: (value) => setSort(value as SortKey),
              options: [
                { value: "name", label: "이름순" },
                { value: "usage", label: "사용률 높은 순" },
                { value: "membership", label: "상태순" },
              ],
            },
          ]}
        />
      )}

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      {chip !== "invites" && (
      <AdminTable
        columns={columns}
        rows={rows}
        rowKey={(member) => member.user_id}
        rowHref={(member) => memberHref(member.user_id)}
        rowActions={(member) =>
          isPending(member) ? (
            <span className={styles.rowButtons}>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: `참여 신청 승인 — ${member.display_name}`,
                    effect: `신청한 그대로 동아리 지원 ${formatKrw(member.requested_budget_krw ?? 0)}의 지갑이 만들어지고, ${member.display_name}이(가) ${selected.display_name}에 참여하게 됩니다.`,
                    confirmLabel: "승인",
                    onConfirm: () => review(member, true),
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
                    title: `참여 신청 거절 — ${member.display_name}`,
                    effect: `${member.display_name}은(는) ${selected.display_name}에 참여하지 못하고 지원금도 받지 못합니다. 신청은 다시 올릴 수 있습니다.`,
                    confirmLabel: "거절",
                    danger: true,
                    reason: { label: "거절 사유", placeholder: "예: 이번 분기 예산이 모두 배정되었습니다.", required: true },
                    onConfirm: (reason) => review(member, false, reason),
                  })
                }
              >
                거절
              </button>
            </span>
          ) : (
          <RowMenu
            items={[
              {
                label: "상세 열기",
                onSelect: () => router.push(memberHref(member.user_id)),
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
                    // 회원 상세의 탈퇴 처리와 같은 규칙으로 처리됩니다(백엔드가
                    // 같은 서비스를 부릅니다). 게시 작품을 내릴지는 여기서 고를
                    // 수 없어 기본값인 공개 유지로 처리하고, 그렇다고 적습니다.
                    effect: [
                      `${member.display_name}은(는) 로그인할 수 없습니다. 열려 있는 로그인도 바로 끊깁니다.`,
                      "남은 동아리 지원은 해제됩니다. 개인 충전 잔액이 있으면 '환불 대기'가 됩니다.",
                      `게시한 작품은 공개된 채 "탈퇴 회원"으로 표시됩니다. 게시를 취소하려면 회원 상세에서 탈퇴 처리하세요.`,
                      "30일 안에는 회원 상세에서 복구할 수 있습니다.",
                    ],
                    confirmLabel: "탈퇴 처리",
                    danger: true,
                    onConfirm: () => changeMembership(member, "former"),
                  }),
              },
            ]}
          />
          )
        }
        empty="조건에 맞는 회원이 없습니다."
      />
      )}

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

      {openMember && (
        <MemberPanel
          userId={Number(openMember)}
          onClose={() => router.push(memberHref(null))}
          fullHref={withQuarter(`/admin/members/${openMember}`, selected.id)}
          onChanged={() => void reload()}
        />
      )}
    </>
  );
}

function PageHeader({ note }: { note?: string }) {
  return (
    <SharedPageHeader
      eyebrow="Admin"
      title={sectionLabel("members")}
      titleAddon={<>{note && <span className={styles.sectionNote}> {note}</span>}</>}
      subtitle={
        <>
          참여 신청, 회원, 초대 코드. 줄을 누르면 오른쪽에 회원 상세가 열려요 — 지원금 조정,
          참여 상태, 역할, 지운 작업 복구가 모두 거기 있어요.
        </>
      }
    />
  );
}
