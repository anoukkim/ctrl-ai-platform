"use client";

/**
 * Admin — 회원 상세. 한 회원에게 할 수 있는 모든 일이 여기 있습니다.
 *
 * 작업을 목록에서 걷어 내 이 화면으로 모은 이유: 남의 참여 상태나 예산을
 * 바꾸기 전에 그 사람을 보고 있어야 합니다. 목록의 줄에 붙은 버튼은 누가
 * 누구인지 보지 않고도 눌러집니다.
 *
 * 모든 작업은 확인창을 지나갑니다. 확인창은 "정말로?"를 묻는 것이 아니라
 * 무슨 일이 생기는지를 적습니다 — 탈퇴 처리는 로그인을 막고, 지원금
 * 조정은 쓸 수 있는 돈을 바꿉니다.
 */

import { useCallback, useEffect, useState } from "react";

import {
  ROLE_LABEL,
  formatWhen,
  getMemberDetail,
  type MemberDetail,
} from "@/lib/admin";
import { useSite } from "@/app/components/SiteProvider";
import { describeError } from "@/lib/http";
import {
  MEMBERSHIP_LABEL,
  adjustAllocation,
  getAdjustments,
  type WalletAdjustment,
  formatDate,
  formatKrw,
  setMemberRole,
  setQuarterMembership,
  type MembershipStatus,
} from "@/lib/quarters";

import { useAdminQuarter } from "../../AdminQuarterProvider";
import { useBreadcrumbTail } from "../../AdminFrame";
import AdminTable, { type Column } from "../../components/AdminTable";
import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import ResultMessage, { type Result } from "../../components/ResultMessage";
import {
  AccountBadge,
  ApplicationBadge,
  MembershipBadge,
  QuarterBadge,
  TopUpBadge,
} from "../../components/StatusBadge";

import styles from "../../admin.module.css";
import Fact from "./Fact";
import MemberDeletedWork from "./MemberDeletedWork";
import MemberUsagePanel from "./MemberUsagePanel";
import PasswordReset from "./PasswordReset";
import WithdrawalPanel from "./WithdrawalPanel";
import PageHeader from "@/app/components/PageHeader";
import Skeleton from "@/app/components/Skeleton";

export default function MemberDetailView({
  userId,
  embedded = false,
  onChanged,
}: {
  userId: number;
  /** admin-consolidation v3: shown as the Members list's right-hand panel. */
  embedded?: boolean;
  /** After any change (the list re-reads its row). */
  onChanged?: () => void;
}) {
  const site = useSite();
  const { selected, refresh: refreshDashboard } = useAdminQuarter();

  const [member, setMember] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  // 조정 기록 표를 다시 읽게 하는 번호(cost-clarity).
  const [adjustVersion, setAdjustVersion] = useState(0);

  // In the list's panel the breadcrumb stays the list's.
  useBreadcrumbTail(embedded ? null : (member?.display_name ?? null));
  const { state: viewer } = useCurrentUser();
  const currentUserId = viewer.phase === "authenticated" ? viewer.user.id : null;

  const load = useCallback(async () => {
    try {
      setMember(await getMemberDetail(userId));
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [userId]);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    getMemberDetail(userId)
      .then((row) => {
        if (!cancelled) setMember(row);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  /**
   * 작업 한 번의 전체 흐름: 확인 → 실행 → 결과 → 다시 읽기.
   *
   * 한 군데에 모아 둔 이유는 빠뜨리기 쉬운 것이 마지막 두 단계이기
   * 때문입니다. 다시 읽지 않으면 화면이 바뀌기 전의 값을 계속 보여 주고,
   * 결과를 적지 않으면 성공과 아무 일도 없었음이 똑같이 보입니다.
   */
  const run = useCallback(
    async (succeeded: string, action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        setResult({ kind: "ok", text: succeeded });
        await load();
        // 사이드바와 탭의 숫자도 같이 바뀝니다.
        await refreshDashboard();
        onChanged?.();
      } catch (caught) {
        setResult({ kind: "error", text: describeError(caught) });
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [load, refreshDashboard, onChanged],
  );

  if (error !== null) {
    return (
      <div className="card">
        <p className="small muted">회원 정보를 불러오지 못했습니다. {error}.</p>
      </div>
    );
  }

  if (member === null) {
    return <Skeleton />;
  }

  const quarterRows = member.quarters;
  // 탈퇴가 열려 있으면 참여 상태로는 되돌리지 않습니다 — 백엔드도 거절합니다.
  const withdrawn = member.withdrawal !== null && member.withdrawal.restored_at === null;
  const currentRow = quarterRows.find((row) => row.quarter_id === selected?.id) ?? null;

  const membershipActions: { status: MembershipStatus; label: string; effect: string }[] = [
    {
      status: "active",
      label: "참여 등록",
      effect: `${member.display_name}이(가) 이 분기에 참여하게 되고, 앱과 영상을 만들 수 있습니다.`,
    },
    {
      status: "inactive",
      label: "비활동으로",
      effect: `${member.display_name}은(는) 로그인과 조회는 되지만, 이 분기에 새로 만들 수 없습니다. 이미 만든 것은 그대로 남습니다.`,
    },
    // 탈퇴 처리는 아래 "회원 탈퇴" 영역에 있습니다. 게시 작품을 어떻게
    // 할지 함께 골라야 하고, 복구와 환불도 같은 자리에서 다루기 때문입니다.
  ];

  const historyColumns: Column<MemberDetail["quarters"][number]>[] = [
    {
      key: "quarter",
      header: "분기",
      render: (row) => (
        <span className={styles.memberName}>
          {row.quarter_display_name}
          <span className={styles.memberHandle}>{row.quarter_code}</span>
        </span>
      ),
    },
    {
      key: "quarter-status",
      header: "분기 상태",
      render: (row) => <QuarterBadge status={row.quarter_status} />,
    },
    {
      key: "membership",
      header: "참여",
      render: (row) => <MembershipBadge status={row.membership_status} />,
    },
    {
      key: "application",
      header: "신청",
      render: (row) =>
        row.application ? (
          <span className={styles.stackCell}>
            <ApplicationBadge status={row.application.status} />
            <span className="small dim">{formatKrw(row.application.requested_budget_krw)}</span>
          </span>
        ) : (
          <span className="small dim">신청 없음</span>
        ),
    },
    {
      key: "allocation",
      header: "지원금 (남음 / 배정)",
      numeric: true,
      render: (row) =>
        row.allocation ? (
          <span>
            {formatKrw(row.allocation.remaining_krw)} / {formatKrw(row.allocation.budget_krw)}
          </span>
        ) : (
          <span className="small dim">배정 없음</span>
        ),
    },
  ];

  return (
    <div className={styles.sections}>
      <PageHeader
        eyebrow="Admin"
        title={member.display_name}
        titleAddon={<span className={styles.titleHandle}>@{member.username}</span>}
        subtitle={
          <>
            계정 상태는 로그인할 수 있는지를, 참여 상태는 그 분기에 만들 수 있는지를 말합니다.
            두 가지는 서로 다른 질문이라 따로 관리합니다.
          </>
        }
      />

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      {/* ---------- 계정 ---------- */}
      <section aria-labelledby="member-account">
        <h2 className="section-title" id="member-account">
          계정
        </h2>
        <div className={`card ${styles.factGrid}`}>
          <Fact label="아이디" value={`@${member.username}`} mono />
          <Fact label="이메일" value={member.email} mono />
          <Fact label="가입" value={formatWhen(member.created_at)} mono />
          <Fact
            label="계정 상태"
            value={<AccountBadge status={member.account_status} />}
          />
          <Fact
            label="역할"
            value={
              <span
                className={`badge ${member.role === "admin" ? "badge-accent" : "badge-muted"}`}
              >
                {ROLE_LABEL[member.role]}
              </span>
            }
          />
        </div>

        {/* 역할: 지금 역할이 눌린 두 칸짜리 단추. 다른 칸을 누르면 같은
            확인창이 뜹니다. */}
        <div
          className={`segmented ${styles.segmentedControl}`}
          role="group"
          aria-label="역할"
        >
          {(["member", "admin"] as const).map((role) => (
            <button
              className="chip"
              key={role}
              type="button"
              aria-pressed={member.role === role}
              disabled={busy || member.role === role}
              title={
                member.role === role
                  ? undefined
                  : member.role === "admin"
                    ? "관리자 권한 해제"
                    : "관리자로 지정"
              }
              onClick={() =>
                setConfirm({
                  title: member.role === "admin" ? "관리자 권한 해제" : "관리자로 지정",
                  effect:
                    member.role === "admin"
                      ? `${member.display_name}은(는) 더 이상 Admin 화면을 열 수 없고, 회원 자격과 지원금을 바꿀 수 없습니다.`
                      : `${member.display_name}이(가) 모든 회원의 자격과 지원금을 바꿀 수 있게 됩니다.`,
                  confirmLabel: member.role === "admin" ? "권한 해제" : "관리자로 지정",
                  danger: member.role !== "admin",
                  onConfirm: () =>
                    run(
                      member.role === "admin"
                        ? `${member.display_name}의 관리자 권한을 해제했습니다.`
                        : `${member.display_name}을(를) 관리자로 지정했습니다.`,
                      () =>
                        setMemberRole(
                          member.user_id,
                          member.role === "admin" ? "member" : "admin",
                        ),
                    ),
                })
              }
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
        {/* 비밀번호 재설정: 내 계정은 Profile에서, 탈퇴한 계정은 로그인할 수 없어요. */}
        {member.user_id !== currentUserId && member.account_status !== "former" && (
          <PasswordReset member={member} busy={busy} run={run} askToConfirm={setConfirm} />
        )}
      </section>

      {/* ---------- 이번 분기 참여 ---------- */}
      <section aria-labelledby="member-membership">
        <h2 className="section-title" id="member-membership">
          참여 상태
          {selected && <span className={styles.sectionNote}>{selected.display_name}</span>}
        </h2>

        {selected === null ? (
          <div className="card">
            <p className="small muted">분기가 없어 참여 상태를 정할 수 없습니다.</p>
          </div>
        ) : (
          <>
            <div className={`card ${styles.factGrid}`}>
              <Fact
                label="이번 분기"
                value={<MembershipBadge status={currentRow?.membership_status ?? null} />}
              />
              <Fact
                label="뜻"
                value={
                  <span className="small muted">
                    {currentRow?.membership_status === "active"
                      ? "앱과 영상을 만들 수 있습니다."
                      : currentRow?.membership_status === "inactive"
                        ? "조회는 되지만 새로 만들 수 없습니다."
                        : currentRow?.membership_status === "former"
                          ? "로그인할 수 없습니다."
                          : "이 분기에 참여 기록이 없습니다 — 비활동과 같은 제한을 받습니다."}
                  </span>
                }
              />
            </div>

            <div
              className={`segmented ${styles.segmentedControl}`}
              role="group"
              aria-label="참여 상태 바꾸기"
            >
              {membershipActions.map((action) => (
                <button
                  className="chip"
                  key={action.status}
                  type="button"
                  aria-pressed={currentRow?.membership_status === action.status}
                  disabled={
                    busy || currentRow?.membership_status === action.status || withdrawn
                  }
                  title={withdrawn ? "탈퇴한 계정은 아래 '복구'로 되돌립니다" : undefined}
                  onClick={() =>
                    setConfirm({
                      title: `${action.label} — ${member.display_name}`,
                      effect: action.effect,
                      confirmLabel: action.label,
                      danger: action.status === "former",
                      onConfirm: () =>
                        run(
                          `${member.display_name}의 참여 상태를 ${
                            MEMBERSHIP_LABEL[action.status]
                          }(으)로 바꿨습니다.`,
                          () =>
                            setQuarterMembership(selected.id, member.user_id, action.status),
                        ),
                    })
                  }
                >
                  {action.label}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---------- 지원금 ---------- */}
      {selected !== null && (
        <AllocationSection
          busy={busy}
          member={member}
          quarterName={selected.display_name}
          row={currentRow}
          onAdjust={(amountKrw, reason) =>
            setConfirm({
              title: `지원금 조정 — ${member.display_name}`,
              effect: [
                `${selected.display_name}의 동아리 지원을 ${amountKrw > 0 ? "+" : "−"}${formatKrw(
                  Math.abs(amountKrw),
                )} 조정합니다 (${formatKrw(currentRow?.allocation?.budget_krw ?? 0)} → ${formatKrw(
                  (currentRow?.allocation?.budget_krw ?? 0) + amountKrw,
                )}).`,
                `사유: ${reason}`,
                "덮어쓰지 않고 조정 기록 한 줄로 남으며, 감사 기록에도 남습니다.",
              ],
              confirmLabel: "지원금 조정",
              danger: amountKrw < 0,
              onConfirm: () =>
                run(`${member.display_name}의 지원금을 조정했습니다.`, async () => {
                  await adjustAllocation(selected.id, member.user_id, amountKrw, reason);
                  setAdjustVersion((value) => value + 1);
                }),
            })
          }
        />
      )}

      <AdjustmentHistory userId={member.user_id} version={adjustVersion} />

      {/* ---------- 분기 이력 ---------- */}
      <section aria-labelledby="member-history">
        <h2 className="section-title" id="member-history">
          분기 이력
          <span className={styles.sectionNote}>
            참여하지 않은 분기도 함께 보여 줍니다
          </span>
        </h2>
        <AdminTable
          columns={historyColumns}
          rows={quarterRows}
          rowKey={(row) => row.quarter_id}
          empty="아직 분기가 없습니다."
        />
      </section>

      {/* ---------- 개인 잔액 ----------
          개인 충전이 꺼져 있는 동안(personal-topup-off)은 이 회원에게 실제
          개인 돈이나 충전 기록이 있을 때만 보입니다 — 정리할 돈은 숨기지
          않고, 없는 기능은 보여 주지 않습니다. */}
      {(site.top_ups_enabled ||
        (member.personal?.balance_krw ?? 0) > 0 ||
        member.top_ups.length > 0) && (
        <section aria-labelledby="member-personal">
          <h2 className="section-title" id="member-personal">
            개인 잔액
            <span className={styles.sectionNote}>
              동아리 지원금과 더하지 않습니다
            </span>
          </h2>
          <div className={`card ${styles.factGrid}`}>
            <Fact label="충전 잔액" value={formatKrw(member.personal?.balance_krw ?? 0)} mono />
            <Fact label="개인 사용" value={formatKrw(member.personal?.consumed_krw ?? 0)} mono />
            <Fact
              label="남은 개인 잔액"
              value={formatKrw(member.personal?.remaining_krw ?? 0)}
              mono
            />
            <Fact
              label="개인 잔액 사용"
              value={
                <span className={`badge ${member.personal?.overage_enabled ? "badge-ok" : "badge-muted"}`}>
                  {member.personal?.overage_enabled ? "회원이 허용" : "꺼짐"}
                </span>
              }
            />
          </div>

          {member.top_ups.length > 0 && (
            <div style={{ marginTop: "0.7rem" }}>
              <AdminTable
                columns={[
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
                    render: (topUp) => formatDate(topUp.requested_at),
                  },
                  {
                    key: "reference",
                    header: "입금 참조",
                    render: (topUp) => topUp.payment_reference || "—",
                  },
                ]}
                rows={member.top_ups}
                rowKey={(topUp) => topUp.id}
                empty="충전 신청이 없습니다."
              />
            </div>
          )}
        </section>
      )}

      {/* ---------- 회원 탈퇴 ---------- */}
      <WithdrawalPanel
        askToConfirm={setConfirm}
        busy={busy}
        member={member}
        run={run}
        onError={(text) => setResult({ kind: "error", text })}
      />

      {/* ---------- 사용 내역 (admin-consolidation v3, batch 3) ---------- */}
      <MemberUsagePanel userId={member.user_id} />

      {/* ---------- 지운 작업 (admin-consolidation v3: Deleted Items moved here) ---------- */}
      <MemberDeletedWork userId={member.user_id} onChanged={onChanged} />

      {/* ---------- 이 회원의 감사 기록 ---------- */}
      <section aria-labelledby="member-audit">
        <h2 className="section-title" id="member-audit">
          이 회원의 기록
          <span className={styles.sectionNote}>읽기 전용 · 수정하거나 지울 수 없습니다</span>
        </h2>
        <AdminTable
          columns={[
            {
              key: "when",
              header: "시각",
              numeric: true,
              render: (entry) => formatWhen(entry.created_at),
            },
            {
              key: "action",
              header: "작업",
              render: (entry) => <span className="badge badge-muted">{entry.action_label}</span>,
            },
            { key: "summary", header: "내용", render: (entry) => entry.summary },
            {
              key: "actor",
              header: "한 사람",
              render: (entry) => (
                <span className={styles.memberHandle}>@{entry.actor_username || "—"}</span>
              ),
            },
          ]}
          rows={member.audit}
          rowKey={(entry) => entry.id}
          empty="이 회원에 대한 기록이 아직 없습니다."
        />
      </section>

      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/**
 * 지원금 — 이번 분기 지갑과 조정 (cost-clarity).
 *
 * 조정은 덮어쓰기가 아니라 +/− 금액과 사유 한 줄입니다. 이미 쓴 돈보다 적게
 * 줄일 수는 없고(백엔드가 거절), 마감한 분기의 지갑은 바꿀 수 없습니다.
 */
function AllocationSection({
  member,
  row,
  quarterName,
  busy,
  onAdjust,
}: {
  member: MemberDetail;
  row: MemberDetail["quarters"][number] | null;
  quarterName: string;
  busy: boolean;
  onAdjust: (amountKrw: number, reason: string) => void;
}) {
  const allocation = row?.allocation ?? null;
  const [amount, setAmount] = useState("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  const amountKrw = Number(amount.replaceAll(",", "")) || 0;
  const maxDown = allocation ? allocation.budget_krw - allocation.consumed_krw : 0;
  const tooLow = sign === -1 && amountKrw > maxDown;
  const valid = amountKrw > 0 && reason.trim() !== "" && !tooLow;

  return (
    <section aria-labelledby="member-allocation">
      <h2 className="section-title" id="member-allocation">
        지원금
        <span className={styles.sectionNote}>{quarterName} · 원(KRW) 기준</span>
      </h2>

      {allocation === null ? (
        <div className="card">
          <p className="small muted">
            이 분기에는 배정된 지원금이 없습니다. 참여 신청을 승인하면 신청한 금액대로
            만들어집니다.
          </p>
        </div>
      ) : (
        <div className={`card ${styles.allocationCard}`}>
          {/* 쓴 만큼 차는 막대 — Usage 화면과 같은 뜻입니다. */}
          <div className={styles.allocationMeters}>
            <div className={styles.allocationMeter}>
              <div className={styles.allocationMeterLabel}>
                <span>동아리 지원</span>
                <span className="numeric">
                  {formatKrw(allocation.consumed_krw)} / {formatKrw(allocation.budget_krw)}
                </span>
              </div>
              <div className="meter">
                <div
                  className="meter-fill"
                  style={{
                    width: `${
                      allocation.budget_krw > 0
                        ? Math.min(
                            100,
                            Math.round((allocation.consumed_krw / allocation.budget_krw) * 100),
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div className={styles.factGrid}>
            <Fact label="배정" value={formatKrw(allocation.budget_krw)} mono />
            <Fact label="사용" value={formatKrw(allocation.consumed_krw)} mono />
            <Fact label="남음" value={formatKrw(allocation.remaining_krw)} mono />
          </div>
        </div>
      )}

      {!open ? (
        <div className={styles.actionRow}>
          <button
            className="btn btn-sm"
            type="button"
            disabled={busy || allocation === null}
            onClick={() => setOpen(true)}
            title={
              allocation === null ? "먼저 참여 신청을 승인해야 조정할 수 있습니다" : undefined
            }
          >
            지원금 조정
          </button>
        </div>
      ) : (
        <div className={`card ${styles.allocationForm}`} data-testid="adjust-form">
          <p className="small muted">
            {member.display_name}의 {quarterName} 지원금을 원 단위로 더하거나 뺍니다. 기록은
            덮어쓰지 않고 한 줄씩 쌓입니다.
          </p>
          <div className={styles.segmentedControl} role="group" aria-label="더하기 또는 빼기">
            <button
              type="button"
              className="chip"
              aria-pressed={sign === 1}
              onClick={() => setSign(1)}
            >
              + 더하기
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={sign === -1}
              onClick={() => setSign(-1)}
            >
              − 빼기
            </button>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="allocation-amount">
              금액 (원)
            </label>
            <input
              className="field"
              id="allocation-amount"
              inputMode="numeric"
              placeholder="10000"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="allocation-reason">
              사유 (필수)
            </label>
            <input
              className="field"
              id="allocation-reason"
              placeholder="예: 발표 준비로 추가 지원"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {tooLow ? (
            <p className={styles.fieldError} role="alert">
              이미 쓴 금액보다 적게 줄일 수 없습니다. 최대 {formatKrw(maxDown)}까지 뺄 수 있습니다.
            </p>
          ) : (
            <p className="small dim">
              채팅, 빌더, 영상 등 모든 기능이 이 지갑 하나에서 차감됩니다. 이미 쓴{" "}
              {formatKrw(allocation?.consumed_krw ?? 0)}은 그대로 남습니다.
            </p>
          )}
          <div className={styles.actionRow}>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={busy || !valid}
              onClick={() => onAdjust(sign * amountKrw, reason.trim())}
            >
              조정하기
            </button>
            <button
              className="btn btn-sm"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** 이 회원의 지갑 조정 기록 — 관리자 조정과 이월, 새것부터. */
function AdjustmentHistory({ userId, version }: { userId: number; version: number }) {
  const [rows, setRows] = useState<WalletAdjustment[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdjustments(userId)
      .then((loaded) => {
        if (!cancelled) setRows(loaded);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  if (rows === null || rows.length === 0) return null;
  return (
    <section aria-labelledby="member-adjustments">
      <h2 className="section-title" id="member-adjustments">
        지원금 조정 기록
        <span className={styles.sectionNote}>덮어쓰지 않고 쌓입니다 · 감사 기록에도 남음</span>
      </h2>
      <AdminTable
        columns={[
          { key: "when", header: "날짜", render: (row) => row.created_at.slice(0, 10).replaceAll("-", ".") },
          { key: "quarter", header: "분기", render: (row) => row.quarter_name },
          {
            key: "amount",
            header: "금액",
            numeric: true,
            render: (row) => `${row.amount_krw > 0 ? "+" : "−"}${formatKrw(Math.abs(row.amount_krw))}`,
          },
          {
            key: "after",
            header: "조정 후",
            numeric: true,
            render: (row) => formatKrw(row.budget_after_krw),
          },
          {
            key: "reason",
            header: "사유",
            render: (row) => (row.kind === "carry_over" ? `이월 — ${row.reason}` : row.reason),
          },
          { key: "by", header: "한 사람", render: (row) => `@${row.created_by_username || "–"}` },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        empty="조정 기록이 없습니다."
        caption="지원금 조정 기록"
      />
    </section>
  );
}
