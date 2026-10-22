"use client";

/**
 * Admin — 회원 상세. 한 회원에게 할 수 있는 모든 일이 여기 있습니다.
 *
 * 두 곳에서 그려집니다: 회원 목록의 오른쪽 판(`panel`이 있을 때 — 판의
 * 제목이 회원 이름)과 전체 화면 `/admin/members/[id]`(빵가루 끝과 틀의
 * 제목이 회원 이름). admin-ui-unify: 맨 위 상태 카드(계정 · 참여 · 지원금),
 * 그 아래 묶음(`PanelSection`)마다 하나의 일.
 *
 * 모든 작업은 확인창을 지나갑니다. 확인창은 "정말로?"를 묻는 것이 아니라
 * 무슨 일이 생기는지를 적습니다 — 탈퇴 처리는 로그인을 막고, 지원금
 * 조정은 쓸 수 있는 돈을 바꿉니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  ACCOUNT_STATUS_LABEL,
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
  membershipLabel,
  type WalletAdjustment,
  formatDate,
  formatKrw,
  setMemberRole,
  setQuarterMembership,
  type MembershipStatus,
} from "@/lib/quarters";

import { useAdminQuarter } from "../../AdminQuarterProvider";
import { useBreadcrumbTail } from "../../AdminFrame";
import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import ResultMessage, { type Result } from "../../components/ResultMessage";
import {
  DataTable,
  NumField,
  PanelBar,
  PanelSection,
  SaveBar,
  SidePanel,
  StatusStrip,
  Tag,
  type Tone,
} from "../../components/AdminUI";
import { ApplicationBadge, MembershipBadge, QuarterBadge, TopUpBadge } from "../../components/StatusBadge";

import styles from "../members.module.css";
import { FactItem, Facts } from "./MemberFacts";
import MemberDeletedWork from "./MemberDeletedWork";
import MemberUsagePanel from "./MemberUsagePanel";
import PasswordReset from "./PasswordReset";
import WithdrawalPanel from "./WithdrawalPanel";
import Skeleton from "@/app/components/Skeleton";

const STATUS_TONE: Record<MembershipStatus, Tone> = { active: "ok", inactive: "warn", former: "off" };

/** `PanelSection`의 제목 옆 작은 글. */
function Titled({ title, extra }: { title: string; extra?: ReactNode }) {
  return (
    <>
      {title}
      {extra && <span className={styles.sectionExtra}>{extra}</span>}
    </>
  );
}

export default function MemberDetailView({
  userId,
  panel,
  onChanged,
}: {
  userId: number;
  /** admin-consolidation v3: shown as the Members list's right-hand panel. */
  panel?: { onClose: () => void; fullHref: string };
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

  // In the list's panel the breadcrumb stays the list's; full page: the
  // frame shows the name as the page's h1, so it is not repeated here.
  useBreadcrumbTail(panel ? null : (member?.display_name ?? null));
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
   * 다시 읽지 않으면 화면이 바뀌기 전의 값을 계속 보여 주고, 결과를 적지
   * 않으면 성공과 아무 일도 없었음이 똑같이 보입니다.
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

  let body: ReactNode;
  if (error !== null) {
    body = (
      <div className="card">
        <p className="small muted">회원 정보를 불러오지 못했습니다. {error}.</p>
      </div>
    );
  } else if (member === null) {
    body = <Skeleton />;
  } else {
    body = (
      <DetailBody
        member={member}
        selected={selected}
        busy={busy}
        result={result}
        onDismissResult={() => setResult(null)}
        onError={(text) => setResult({ kind: "error", text })}
        setConfirm={setConfirm}
        run={run}
        adjustVersion={adjustVersion}
        bumpAdjustVersion={() => setAdjustVersion((value) => value + 1)}
        showHandle={!panel}
        canResetPassword={
          member.user_id !== currentUserId && member.account_status !== "former" && member.role !== "admin"
        }
        showPersonal={
          site.top_ups_enabled || (member.personal?.balance_krw ?? 0) > 0 || member.top_ups.length > 0
        }
        onChanged={onChanged}
      />
    );
  }

  const dialog = <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />;

  if (panel) {
    return (
      <>
        <SidePanel
          title={member?.display_name ?? "회원 상세"}
          subtitle={
            member ? (
              <span className={styles.line}>
                @{member.username}
                {member.role === "admin" && <Tag tone="accent">관리자</Tag>}
              </span>
            ) : undefined
          }
          onClose={panel.onClose}
          width="wide"
          testId="member-panel"
          footer={
            <Link className="btn btn-sm" href={panel.fullHref}>
              전체 화면으로
            </Link>
          }
        >
          {body}
        </SidePanel>
        {dialog}
      </>
    );
  }

  return (
    <>
      {body}
      {dialog}
    </>
  );
}

type QuarterRow = MemberDetail["quarters"][number];

function DetailBody({
  member,
  selected,
  busy,
  result,
  onDismissResult,
  onError,
  setConfirm,
  run,
  adjustVersion,
  bumpAdjustVersion,
  showHandle,
  canResetPassword,
  showPersonal,
  onChanged,
}: {
  member: MemberDetail;
  selected: ReturnType<typeof useAdminQuarter>["selected"];
  busy: boolean;
  result: Result | null;
  onDismissResult: () => void;
  onError: (text: string) => void;
  setConfirm: (request: ConfirmRequest | null) => void;
  run: (succeeded: string, action: () => Promise<unknown>) => Promise<void>;
  adjustVersion: number;
  bumpAdjustVersion: () => void;
  showHandle: boolean;
  canResetPassword: boolean;
  showPersonal: boolean;
  onChanged?: () => void;
}) {
  const quarterRows = member.quarters;
  // 탈퇴가 열려 있으면 참여 상태로는 되돌리지 않습니다 — 백엔드도 거절합니다.
  const withdrawn = member.withdrawal !== null && member.withdrawal.restored_at === null;
  const currentRow = quarterRows.find((row) => row.quarter_id === selected?.id) ?? null;
  const currentStatus = currentRow?.membership_status ?? null;
  const allocation = currentRow?.allocation ?? null;

  const membershipActions: { status: MembershipStatus; label: string; effect: string }[] = [
    {
      status: "active",
      label: "참여 등록",
      effect: `${member.display_name}이(가) 이 분기에 참여하게 되고, 아직 지원금이 없으면 이 분기 동아리 지원이 생깁니다 (참여 신청 승인과 같아요).`,
    },
    {
      status: "inactive",
      label: "참여 중지",
      effect: `${member.display_name}은(는) 로그인과 조회는 되지만, 이 분기에 새로 만들 수 없습니다. 이미 만든 것은 그대로 남습니다.`,
    },
    // 탈퇴 처리는 아래 "회원 탈퇴"에 있습니다 — 게시 작품을 어떻게 할지 함께
    // 골라야 하고, 복구와 환불도 같은 자리에서 다루기 때문입니다.
  ];

  const meaning =
    currentStatus === "active"
      ? "앱과 영상을 만들 수 있어요"
      : currentStatus === "inactive"
        ? "조회는 되지만 새로 만들 수 없어요"
        : currentStatus === "former"
          ? "로그인할 수 없어요"
          : "참여 기록이 없어요 — 새로 만들 수 없어요";

  return (
    <div className={styles.detail}>
      <PanelBar
        note={showHandle ? `@${member.username}${member.role === "admin" ? " · 관리자" : ""}` : "계정 · 참여 · 지원금"}
        help={
          <p>
            계정 상태는 로그인할 수 있는지를, 참여 상태는 그 분기에 만들 수 있는지를 말합니다. 두 가지는 서로 다른
            질문이라 따로 관리합니다. 모든 변경은 확인창을 지나고 감사 기록에 남습니다.
          </p>
        }
      />

      <ResultMessage result={result} onDismiss={onDismissResult} />

      <StatusStrip
        testId="member-status"
        items={[
          {
            key: "account",
            name: "계정",
            tone: STATUS_TONE[member.account_status],
            state: ACCOUNT_STATUS_LABEL[member.account_status],
            note: `${ROLE_LABEL[member.role]} · ${formatWhen(member.created_at)} 가입`,
          },
          {
            key: "membership",
            name: selected ? `${selected.display_name} 참여` : "참여",
            tone: currentStatus ? STATUS_TONE[currentStatus] : "off",
            state: membershipLabel(currentStatus),
            note: selected ? meaning : "분기가 없어요",
          },
          {
            key: "wallet",
            name: "동아리 지원",
            tone: allocation ? (allocation.remaining_krw > 0 ? "ok" : "warn") : "off",
            state: allocation ? `${formatKrw(allocation.remaining_krw)} 남음` : "배정 없음",
            note: allocation
              ? `${formatKrw(allocation.consumed_krw)} / ${formatKrw(allocation.budget_krw)} 사용`
              : "참여 신청을 승인하면 생겨요",
          },
        ]}
      />

      {/* ---------- 계정 ---------- */}
      <PanelSection title="계정">
        <Facts>
          <FactItem label="아이디" value={`@${member.username}`} mono />
          <FactItem label="이메일" value={member.email} mono />
          <FactItem label="가입" value={formatWhen(member.created_at)} mono />
        </Facts>
        {/* 역할: 지금 역할이 눌린 두 칸짜리 단추. 다른 칸을 누르면 확인창이 뜹니다. */}
        <div className={`segmented ${styles.segmented}`} role="group" aria-label="역할">
          {(["member", "admin"] as const).map((role) => (
            <button
              className="chip"
              key={role}
              type="button"
              aria-pressed={member.role === role}
              disabled={busy || member.role === role}
              title={
                member.role === role ? undefined : member.role === "admin" ? "관리자 권한 해제" : "관리자로 지정"
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
                      () => setMemberRole(member.user_id, member.role === "admin" ? "member" : "admin"),
                    ),
                })
              }
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
        {/* 비밀번호 재설정: 내 계정과 관리자 계정은 Profile에서, 탈퇴한 계정은 로그인할 수 없어요. */}
        {canResetPassword && (
          <PasswordReset member={member} busy={busy} askToConfirm={setConfirm} closeConfirm={() => setConfirm(null)} />
        )}
      </PanelSection>

      {/* ---------- 이번 분기 참여 ---------- */}
      <PanelSection title={<Titled title="참여 상태" extra={selected?.display_name} />}>
        {selected === null ? (
          <p className={styles.note}>분기가 없어 참여 상태를 정할 수 없습니다.</p>
        ) : (
          <div className={`segmented ${styles.segmented}`} role="group" aria-label="참여 상태 바꾸기">
            {membershipActions.map((action) => (
              <button
                className="chip"
                key={action.status}
                type="button"
                aria-pressed={currentStatus === action.status}
                disabled={busy || currentStatus === action.status || withdrawn}
                title={withdrawn ? "탈퇴한 계정은 아래 '복구'로 되돌립니다" : undefined}
                onClick={() =>
                  setConfirm({
                    title: `${action.label} — ${member.display_name}`,
                    effect: action.effect,
                    confirmLabel: action.label,
                    onConfirm: () =>
                      run(
                        `${member.display_name}의 참여 상태를 ${MEMBERSHIP_LABEL[action.status]}(으)로 바꿨습니다.`,
                        () => setQuarterMembership(selected.id, member.user_id, action.status),
                      ),
                  })
                }
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </PanelSection>

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
                  bumpAdjustVersion();
                }),
            })
          }
        />
      )}

      <AdjustmentHistory userId={member.user_id} version={adjustVersion} />

      {/* ---------- 사용 내역 (admin-consolidation v3, batch 3) ---------- */}
      <MemberUsagePanel userId={member.user_id} />

      {/* ---------- 분기 이력 ---------- */}
      <PanelSection title={<Titled title="분기 이력" extra="참여하지 않은 분기도" />}>
        {quarterRows.length === 0 ? (
          <p className={styles.note}>아직 분기가 없습니다.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th scope="col">분기</th>
                <th scope="col">참여</th>
                <th scope="col">신청</th>
                <th scope="col" data-numeric="">
                  남음 / 배정
                </th>
              </tr>
            </thead>
            <tbody>
              {quarterRows.map((row: QuarterRow) => (
                <tr key={row.quarter_id}>
                  <td>
                    <span className={styles.line}>
                      {row.quarter_display_name}
                      <span className={styles.dim}>{row.quarter_code}</span>
                      <QuarterBadge status={row.quarter_status} />
                    </span>
                  </td>
                  <td>
                    <MembershipBadge status={row.membership_status} />
                  </td>
                  <td>
                    {row.application ? (
                      <span className={styles.line}>
                        <ApplicationBadge status={row.application.status} />
                        <span className={styles.dim}>{formatKrw(row.application.requested_budget_krw)}</span>
                      </span>
                    ) : (
                      <span className={styles.dim}>신청 없음</span>
                    )}
                  </td>
                  <td data-numeric="">
                    {row.allocation ? (
                      `${formatKrw(row.allocation.remaining_krw)} / ${formatKrw(row.allocation.budget_krw)}`
                    ) : (
                      <span className={styles.dim}>배정 없음</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </PanelSection>

      {/* ---------- 개인 잔액 ----------
          개인 충전이 꺼져 있는 동안(personal-topup-off)은 이 회원에게 실제
          개인 돈이나 충전 기록이 있을 때만 보입니다 — 정리할 돈은 숨기지
          않고, 없는 기능은 보여 주지 않습니다. */}
      {showPersonal && (
        <PanelSection title={<Titled title="개인 잔액" extra="동아리 지원금과 더하지 않습니다" />}>
          <Facts>
            <FactItem label="충전 잔액" value={formatKrw(member.personal?.balance_krw ?? 0)} mono />
            <FactItem label="개인 사용" value={formatKrw(member.personal?.consumed_krw ?? 0)} mono />
            <FactItem label="남은 개인 잔액" value={formatKrw(member.personal?.remaining_krw ?? 0)} mono />
            <FactItem
              label="개인 잔액 사용"
              value={
                member.personal?.overage_enabled ? <Tag tone="ok">회원이 허용</Tag> : <Tag>꺼짐</Tag>
              }
            />
          </Facts>
          {member.top_ups.length > 0 && (
            <DataTable>
              <thead>
                <tr>
                  <th scope="col" data-numeric="">
                    금액
                  </th>
                  <th scope="col">상태</th>
                  <th scope="col" data-numeric="">
                    신청
                  </th>
                  <th scope="col">입금 참조</th>
                </tr>
              </thead>
              <tbody>
                {member.top_ups.map((topUp) => (
                  <tr key={topUp.id}>
                    <td data-numeric="">{formatKrw(topUp.amount_krw)}</td>
                    <td>
                      <TopUpBadge status={topUp.status} />
                    </td>
                    <td data-numeric="">{formatDate(topUp.requested_at)}</td>
                    <td>{topUp.payment_reference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </PanelSection>
      )}

      {/* ---------- 지운 작업 (admin-consolidation v3: Deleted Items moved here) ---------- */}
      <MemberDeletedWork userId={member.user_id} onChanged={onChanged} />

      {/* ---------- 회원 탈퇴 ---------- */}
      <WithdrawalPanel
        askToConfirm={setConfirm}
        busy={busy}
        member={member}
        run={run}
        onError={onError}
      />

      {/* ---------- 이 회원의 감사 기록 ---------- */}
      <PanelSection title={<Titled title="이 회원의 기록" extra="읽기 전용" />}>
        {member.audit.length === 0 ? (
          <p className={styles.note}>이 회원에 대한 기록이 아직 없습니다.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th scope="col">시각</th>
                <th scope="col">작업</th>
                <th scope="col">내용</th>
                <th scope="col">한 사람</th>
              </tr>
            </thead>
            <tbody>
              {member.audit.map((entry) => (
                <tr key={entry.id}>
                  <td data-numeric="">{formatWhen(entry.created_at)}</td>
                  <td>
                    <Tag>{entry.action_label}</Tag>
                  </td>
                  <td>{entry.summary}</td>
                  <td className={styles.dim}>@{entry.actor_username || "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </PanelSection>
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
  row: QuarterRow | null;
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
  const pct =
    allocation && allocation.budget_krw > 0
      ? Math.min(100, Math.round((allocation.consumed_krw / allocation.budget_krw) * 100))
      : 0;

  return (
    <PanelSection title={<Titled title="지원금" extra={`${quarterName} · 원(KRW)`} />}>
      {allocation === null ? (
        <p className={styles.note}>
          이 분기에는 배정된 지원금이 없습니다. 참여 신청을 승인하면 신청한 금액대로 만들어집니다.
        </p>
      ) : (
        <div className={styles.box}>
          {/* 쓴 만큼 차는 막대 — Usage 화면과 같은 뜻입니다. */}
          <div className={styles.meter}>
            <div className={styles.meterLabel}>
              <span>동아리 지원</span>
              <span>
                {formatKrw(allocation.consumed_krw)} / {formatKrw(allocation.budget_krw)}
              </span>
            </div>
            <div className="meter">
              <div className="meter-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <Facts>
            <FactItem label="배정" value={formatKrw(allocation.budget_krw)} mono />
            <FactItem label="사용" value={formatKrw(allocation.consumed_krw)} mono />
            <FactItem label="남음" value={formatKrw(allocation.remaining_krw)} mono />
          </Facts>
        </div>
      )}

      {!open ? (
        <div>
          <button
            className="btn btn-sm"
            type="button"
            disabled={busy || allocation === null}
            onClick={() => setOpen(true)}
            title={allocation === null ? "먼저 참여 신청을 승인해야 조정할 수 있습니다" : undefined}
          >
            지원금 조정
          </button>
        </div>
      ) : (
        <div className={styles.box} data-testid="adjust-form">
          <p className={styles.note}>
            {member.display_name}의 {quarterName} 지원금을 더하거나 뺍니다. 기록은 덮어쓰지 않고 한 줄씩 쌓입니다.
          </p>
          <div className={`segmented ${styles.segmented}`} role="group" aria-label="더하기 또는 빼기">
            <button type="button" className="chip" aria-pressed={sign === 1} onClick={() => setSign(1)}>
              + 더하기
            </button>
            <button type="button" className="chip" aria-pressed={sign === -1} onClick={() => setSign(-1)}>
              − 빼기
            </button>
          </div>
          <NumField
            label="금액"
            unit="원"
            type="text"
            inputMode="numeric"
            value={amount}
            ariaLabel="금액 (원)"
            onChange={setAmount}
          />
          <label className={styles.textField}>
            <span>사유 (필수)</span>
            <input
              className="field"
              placeholder="예: 발표 준비로 추가 지원"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {tooLow ? (
            <p className={styles.error} role="alert">
              이미 쓴 금액보다 적게 줄일 수 없습니다. 최대 {formatKrw(maxDown)}까지 뺄 수 있습니다.
            </p>
          ) : (
            <p className={styles.note}>
              모든 기능이 이 지갑 하나에서 차감됩니다. 이미 쓴 {formatKrw(allocation?.consumed_krw ?? 0)}은 그대로 남습니다.
            </p>
          )}
          <SaveBar>
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => setOpen(false)}>
              취소
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={busy || !valid}
              onClick={() => onAdjust(sign * amountKrw, reason.trim())}
            >
              조정하기
            </button>
          </SaveBar>
        </div>
      )}
    </PanelSection>
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
    <PanelSection title={<Titled title="지원금 조정 기록" extra="덮어쓰지 않고 쌓여요" />}>
      <DataTable>
        <caption className="sr-only">지원금 조정 기록</caption>
        <thead>
          <tr>
            <th scope="col">날짜</th>
            <th scope="col" data-numeric="">
              금액
            </th>
            <th scope="col" data-numeric="">
              조정 후
            </th>
            <th scope="col">사유</th>
            <th scope="col">한 사람</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td data-numeric="">
                {row.created_at.slice(0, 10).replaceAll("-", ".")}
                <span className={styles.dim}> · {row.quarter_name}</span>
              </td>
              <td data-numeric="">{`${row.amount_krw > 0 ? "+" : "−"}${formatKrw(Math.abs(row.amount_krw))}`}</td>
              <td data-numeric="">{formatKrw(row.budget_after_krw)}</td>
              <td>{row.kind === "carry_over" ? `이월 — ${row.reason}` : row.reason}</td>
              <td className={styles.dim}>@{row.created_by_username || "–"}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </PanelSection>
  );
}
