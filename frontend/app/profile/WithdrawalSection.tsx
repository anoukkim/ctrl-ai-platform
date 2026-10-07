"use client";

/**
 * Profile — 회원 탈퇴.
 *
 * 순서가 곧 설계입니다.
 *
 *   1. 처음에는 접혀 있습니다. Profile을 열 때마다 탈퇴 양식을 마주칠
 *      이유는 없습니다.
 *   2. 펼치면 먼저 **작업물을 내려받으라고** 알려 줍니다. 영상과 코드
 *      ZIP은 각 라이브러리의 ⋯ 메뉴에서 받습니다. 탈퇴 뒤에는 로그인할
 *      수 없으니, 받을 수 있는 마지막 때가 지금입니다.
 *   3. 게시한 작품을 어떻게 할지 고릅니다. 기본은 공개 유지 — 탈퇴 회원
 *      으로 표시됩니다(CLAUDE.md §10).
 *   4. 비밀번호를 한 번 더 받습니다. 로그인된 채 열려 있던 브라우저는
 *      회원이 떠나기로 했다는 뜻이 아닙니다.
 *   5. 확인창이 **실제로 일어날 일**을 한 줄씩 적습니다. 문장은
 *      `lib/account.ts`의 `withdrawalEffects`가 만들고, Admin의 탈퇴
 *      처리도 같은 문장을 씁니다.
 *
 * 비밀번호가 틀리면 확인창은 열린 채로 그 이유를 보여 줍니다.
 */

import Link from "next/link";
import { useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import {
  PUBLISHED_WORK_LABEL,
  getMyWithdrawalPreview,
  withdrawMyAccount,
  withdrawalEffects,
  type PublishedWorkChoice,
  type Withdrawal,
  type WithdrawalPreview,
} from "@/lib/account";
import { formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import styles from "./profile.module.css";

const CHOICES: PublishedWorkChoice[] = ["keep", "unpublish"];

export default function WithdrawalSection() {
  const { refresh } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<PublishedWorkChoice>("keep");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Withdrawal | null>(null);

  function expand() {
    setOpen(true);
    setLoadError(null);
    getMyWithdrawalPreview()
      .then(setPreview)
      .catch((caught: unknown) => setLoadError(describeError(caught)));
  }

  function askToConfirm() {
    if (preview === null) return;
    setError(null);
    setConfirm({
      title: "정말 탈퇴할까요? 이렇게 됩니다",
      effect: withdrawalEffects(preview, choice),
      confirmLabel: "탈퇴하기",
      danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          const result = await withdrawMyAccount(password, choice);
          setConfirm(null);
          setPassword("");
          setDone(result);
        } catch (caught) {
          setError(describeError(caught));
        } finally {
          setBusy(false);
        }
      },
    });
  }

  if (done !== null) {
    return (
      <section className={`card ${styles.withdrawal}`} aria-live="polite">
        <h2 className="section-title">탈퇴가 완료되었습니다</h2>
        <p className="small muted">
          그동안 CTRL+AI와 함께해 주셔서 고맙습니다. 로그아웃되었습니다.
        </p>
        {done.refund_status === "pending" && (
          <p className="small muted">
            개인 충전 잔액 {formatKrw(done.refund_amount_krw)}은 관리자가 환불을 처리합니다.
          </p>
        )}
        <p className="small dim">
          마음이 바뀌면 {formatWhen(done.grace_ends_at)}까지 관리자에게 복구를 요청할 수
          있습니다.
        </p>
        <button className="btn btn-sm" type="button" onClick={() => void refresh()}>
          로그인 화면으로
        </button>
      </section>
    );
  }

  if (!open) {
    return (
      <section className={`card ${styles.withdrawal}`}>
        <h2 className="section-title">회원 탈퇴</h2>
        <p className="small dim">
          CTRL+AI를 떠나려면 여기에서 진행합니다. 다음 단계에서 무엇이 바뀌는지 먼저 알려
          드립니다.
        </p>
        <button className="btn btn-sm" type="button" onClick={expand}>
          회원 탈퇴 진행
        </button>
      </section>
    );
  }

  return (
    <section className={`card ${styles.withdrawal}`}>
      <h2 className="section-title">회원 탈퇴</h2>

      <div className={styles.withdrawReminder} role="note">
        <p className={styles.withdrawReminderTitle}>먼저 작업물을 내려받아 두세요</p>
        <p className="small muted">
          탈퇴하면 로그인할 수 없어 내려받을 수도 없습니다. 각 목록의 ⋯ 메뉴에서 받을 수
          있습니다.
        </p>
        <ul className={styles.withdrawLinks}>
          <li>
            <Link href="/video">
              Video Generator — 영상 다운로드
              {preview ? ` (프로젝트 ${preview.video_projects}개)` : ""}
            </Link>
          </li>
          <li>
            <Link href="/builder">
              Project Builder — 코드 다운로드 (ZIP)
              {preview ? ` (프로젝트 ${preview.builder_projects}개)` : ""}
            </Link>
          </li>
        </ul>
      </div>

      {loadError && <p className="small muted">탈퇴 정보를 불러오지 못했습니다. {loadError}.</p>}

      {preview?.refund_hold && (
        <p className={styles.withdrawWarning} role="alert">
          개인 충전 잔액
          {preview.personal_remaining_krw > 0 ? ` ${formatKrw(preview.personal_remaining_krw)}` : ""}
          {preview.pending_top_ups > 0 ? `과 확인 전인 충전 요청 ${preview.pending_top_ups}건` : ""}
          이 있습니다. 탈퇴하면 &lsquo;환불 대기&rsquo;가 되고, 관리자가 환불을 기록할 때까지 계정
          정리가 끝나지 않습니다. 돈은 사라지지 않습니다.
        </p>
      )}

      <fieldset className={styles.withdrawChoice}>
        <legend className={styles.rowLabel}>게시한 작품</legend>
        {CHOICES.map((value) => (
          <label className={styles.withdrawOption} key={value}>
            <input
              type="radio"
              name="published-work"
              value={value}
              checked={choice === value}
              onChange={() => setChoice(value)}
            />
            {PUBLISHED_WORK_LABEL[value]}
          </label>
        ))}
      </fieldset>

      <label className={styles.withdrawPassword}>
        <span className={styles.rowLabel}>비밀번호 확인</span>
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      <div className={styles.withdrawActions}>
        <button className="btn btn-sm" type="button" onClick={() => setOpen(false)}>
          그만두기
        </button>
        <button
          className="btn btn-sm btn-danger"
          type="button"
          onClick={askToConfirm}
          disabled={preview === null || password === ""}
          title={password === "" ? "비밀번호를 입력해야 진행할 수 있습니다" : undefined}
        >
          탈퇴하기
        </button>
      </div>

      <ConfirmDialog
        request={confirm}
        busy={busy}
        error={error}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
      />
    </section>
  );
}
