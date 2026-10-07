"use client";

/**
 * Admin › 회원 상세 — 회원 탈퇴.
 *
 * 탈퇴한 회원이면 그 탈퇴를 보여 줍니다: 언제, 유예 기간이 언제 끝나는지,
 * 환불이 남았는지, 그리고 지금 할 수 있는 두 가지 — 복구와 환불 완료
 * 기록. 아니면 탈퇴 처리를 할 수 있습니다.
 *
 * 탈퇴 처리는 회원이 Profile에서 하는 탈퇴와 **같은 규칙**입니다.
 * 백엔드가 같은 서비스를 부르고, 확인창도 같은 `withdrawalEffects`가
 * 씁니다. 다른 점은 비밀번호를 묻지 않는다는 것 하나입니다.
 *
 * 복구 버튼을 보일지는 백엔드가 준 `can_restore`로 정합니다. 30일을 여기서
 * 세면 화면의 시계와 서버의 시계가 어긋나는 날, 버튼은 있는데 눌러지지
 * 않습니다.
 */

import { useState } from "react";

import type { ConfirmRequest } from "@/app/components/ConfirmDialog";
import {
  PUBLISHED_WORK_LABEL,
  REFUND_STATUS_BADGE,
  REFUND_STATUS_LABEL,
  getMemberWithdrawalPreview,
  recordRefund,
  restoreMember,
  withdrawMember,
  withdrawalEffects,
  type PublishedWorkChoice,
} from "@/lib/account";
import { formatWhen, type MemberDetail } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import styles from "../../admin.module.css";
import Fact from "./Fact";

interface Props {
  member: MemberDetail;
  busy: boolean;
  /** 이 화면의 공통 흐름: 실행 → 결과 → 다시 읽기. */
  run: (succeeded: string, action: () => Promise<unknown>) => Promise<void>;
  askToConfirm: (request: ConfirmRequest) => void;
  /** 미리보기를 불러오지 못했을 때 화면 위쪽 결과 줄에 띄웁니다. */
  onError: (text: string) => void;
}

export default function WithdrawalPanel({ member, busy, run, askToConfirm, onError }: Props) {
  const [choice, setChoice] = useState<PublishedWorkChoice>("keep");
  const withdrawal = member.withdrawal;
  const open = withdrawal !== null && withdrawal.restored_at === null;

  async function startWithdrawal() {
    try {
      const preview = await getMemberWithdrawalPreview(member.user_id);
      askToConfirm({
        title: `탈퇴 처리 — ${member.display_name}`,
        effect: withdrawalEffects(preview, choice, "admin"),
        confirmLabel: "탈퇴 처리",
        danger: true,
        onConfirm: () =>
          run(`${member.display_name}을(를) 탈퇴 처리했습니다.`, () =>
            withdrawMember(member.user_id, choice),
          ),
      });
    } catch (caught) {
      onError(describeError(caught));
    }
  }

  return (
    <section aria-labelledby="member-withdrawal">
      <h2 className="section-title" id="member-withdrawal">
        회원 탈퇴
        <span className={styles.sectionNote}>
          30일 안에는 복구할 수 있습니다
        </span>
      </h2>

      {open && withdrawal ? (
        <>
          <div className={`card ${styles.factGrid}`}>
            <Fact
              label="탈퇴"
              value={`${formatWhen(withdrawal.withdrawn_at)} · ${
                withdrawal.self_initiated ? "본인" : "관리자 처리"
              }`}
              mono
            />
            <Fact
              label={withdrawal.anonymised_at ? "개인정보 삭제" : "유예 기간 끝"}
              value={formatWhen(withdrawal.anonymised_at ?? withdrawal.grace_ends_at)}
              mono
            />
            <Fact
              label="환불"
              value={
                <span className={styles.stackCell}>
                  <span className={`badge ${REFUND_STATUS_BADGE[withdrawal.refund_status]}`}>
                    {REFUND_STATUS_LABEL[withdrawal.refund_status]}
                  </span>
                  {withdrawal.refund_status !== "none" && (
                    <span className="small dim">
                      {formatKrw(withdrawal.refund_amount_krw)}
                      {withdrawal.refund_recorded_at &&
                        ` · ${formatWhen(withdrawal.refund_recorded_at)}`}
                      {withdrawal.refund_reference && ` · ${withdrawal.refund_reference}`}
                    </span>
                  )}
                </span>
              }
            />
            <Fact label="해제한 동아리 지원" value={formatKrw(withdrawal.released_krw)} mono />
            <Fact label="게시한 작품" value={PUBLISHED_WORK_LABEL[withdrawal.published_work]} />
          </div>

          {withdrawal.refund_status === "pending" && (
            <p className="small muted" style={{ marginTop: "0.5rem" }}>
              개인 충전 잔액이 남아 있습니다. 환불을 기록하기 전에는 유예 기간이 지나도 개인정보를
              삭제하지 않습니다.
            </p>
          )}

          <div className={styles.actionRow}>
            {withdrawal.refund_status === "pending" && (
              <button
                className="btn btn-sm"
                type="button"
                disabled={busy}
                onClick={() =>
                  askToConfirm({
                    title: `환불 완료 기록 — ${member.display_name}`,
                    effect: `${member.display_name}에게 남은 개인 충전 잔액을 돌려줬다고 기록합니다. 잔액은 0원이 되고, 이 기록은 감사 기록에 남습니다.`,
                    confirmLabel: "환불 완료 기록",
                    reason: { label: "이체 번호나 메모", placeholder: "예: 국민은행 이체 1234" },
                    onConfirm: (reference) =>
                      run(`${member.display_name}의 환불을 기록했습니다.`, () =>
                        recordRefund(member.user_id, reference),
                      ),
                  })
                }
              >
                환불 완료 기록
              </button>
            )}
            {withdrawal.can_restore && (
              <button
                className="btn btn-sm"
                type="button"
                disabled={busy}
                onClick={() =>
                  askToConfirm({
                    title: `복구 — ${member.display_name}`,
                    effect: [
                      `${member.display_name}은(는) 다시 로그인할 수 있습니다.`,
                      "탈퇴할 때 해제한 동아리 지원과 참여 상태, 게시를 취소한 작품을 되돌립니다.",
                      "환불 대기였다면 취소됩니다 — 회원이 잔액을 그대로 갖고 돌아옵니다.",
                    ],
                    confirmLabel: "복구",
                    onConfirm: () =>
                      run(`${member.display_name}의 계정을 복구했습니다.`, () =>
                        restoreMember(member.user_id),
                      ),
                  })
                }
              >
                복구
              </button>
            )}
            {!withdrawal.can_restore && (
              <span className="small dim">
                {withdrawal.anonymised_at
                  ? "개인정보가 삭제되어 복구할 수 없습니다."
                  : "유예 기간이 지나 복구할 수 없습니다."}
              </span>
            )}
          </div>
        </>
      ) : member.account_status === "former" ? (
        <div className="card">
          <p className="small muted">
            탈퇴 기록이 생기기 전에 탈퇴 처리된 계정입니다. 되돌린 돈이나 환불 대기가 기록되어 있지
            않으므로, 다시 받아들이려면 참여 상태에서 참여 등록을 하세요.
          </p>
        </div>
      ) : (
        <div className={`card ${styles.dangerCard}`}>
          {withdrawal?.restored_at && (
            <p className="small dim" style={{ marginBottom: "0.5rem" }}>
              {formatWhen(withdrawal.withdrawn_at)}에 탈퇴했다가 {formatWhen(withdrawal.restored_at)}
              에 복구되었습니다.
            </p>
          )}
          <fieldset className={styles.withdrawChoice}>
            <legend className="small muted">게시한 작품</legend>
            {(["keep", "unpublish"] as const).map((value) => (
              <label className={styles.withdrawOption} key={value}>
                <input
                  type="radio"
                  name="admin-published-work"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                />
                {PUBLISHED_WORK_LABEL[value]}
              </label>
            ))}
          </fieldset>
          <div className={styles.actionRow}>
            <button
              className="btn btn-sm btn-danger"
              type="button"
              disabled={busy}
              onClick={() => void startWithdrawal()}
            >
              탈퇴 처리
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
