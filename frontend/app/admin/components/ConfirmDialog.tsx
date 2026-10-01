"use client";

/**
 * 되돌리기 어려운 변경 앞에 한 번 멈춰 세우는 확인창.
 *
 * Admin의 작업은 남의 계정과 남의 돈을 건드립니다. 이전 화면은 표 안의
 * 작은 버튼을 누르면 곧바로 반영했고, 잘못 누른 것을 되돌릴 방법은
 * 반대 작업을 다시 하는 것뿐이었습니다.
 *
 * 그래서 문구가 "정말로 하시겠습니까?"가 아니라 **무슨 일이 생기는지**를
 * 말합니다 — "탈퇴 처리하면 로그인할 수 없습니다". 확인창의 값은 멈추는
 * 데 있는 것이 아니라, 멈춘 동안 읽을 내용에 있습니다.
 *
 * 거절처럼 이유가 필요한 작업은 여기에서 한 줄을 받습니다. 이미 멈춰
 * 세우는 자리이고, 이유 없는 거절은 회원도 나중에 기록을 보는 관리자도
 * 설명할 수 없습니다.
 *
 * `<dialog>` 대신 직접 그립니다: 이 화면들은 브라우저 자동화로도
 * 확인하는데, 브라우저의 모달 대화상자는 이후 조작을 전부 막습니다.
 */

import { useEffect, useRef, useState } from "react";

import styles from "../admin.module.css";

export interface ConfirmRequest {
  title: string;
  /** 이 작업이 실제로 무엇을 바꾸는지. 한 문장이면 충분합니다. */
  effect: string;
  confirmLabel: string;
  /** 계정을 닫거나 돈을 움직이는 작업은 빨간 버튼으로 구분합니다. */
  danger?: boolean;
  /** 이유를 함께 받아야 하는 작업 — 거절이 그렇습니다. */
  reason?: {
    label: string;
    placeholder?: string;
    /** 비어 있으면 확인 버튼이 눌리지 않습니다. */
    required?: boolean;
  };
  onConfirm: (reason: string) => void | Promise<void>;
}

interface Props {
  request: ConfirmRequest | null;
  onClose: () => void;
  busy?: boolean;
}

/**
 * 바깥 껍데기는 열렸는지만 봅니다.
 *
 * 내용은 따로 둔 컴포넌트이고, 닫히면 아예 사라집니다. 적어 둔 이유가
 * 그때 함께 사라지게 하려는 것입니다 — 효과로 지우면 창이 열릴 때마다
 * 상태를 한 번 더 바꾸게 되고, 지우는 것을 잊으면 앞 사람의 거절 사유가
 * 다음 사람에게 붙습니다.
 */
export default function ConfirmDialog({ request, onClose, busy = false }: Props) {
  if (request === null) return null;
  return <Dialog busy={busy} request={request} onClose={onClose} />;
}

function Dialog({
  request,
  onClose,
  busy,
}: {
  request: ConfirmRequest;
  onClose: () => void;
  busy: boolean;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");

  // 열리면 초점을 둡니다 — 이유를 받는 창이면 그 칸에, 아니면 확인
  // 버튼에. 키보드만 쓰는 사람이 열린 창을 찾아 헤매지 않도록.
  useEffect(() => {
    if (request.reason) reasonRef.current?.focus();
    else confirmRef.current?.focus();
  }, [request.reason]);

  // Esc로 닫습니다.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const missingReason = request.reason?.required === true && reason.trim() === "";

  return (
    <div
      className={styles.dialogBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        aria-describedby="admin-confirm-effect"
      >
        <h2 className={styles.dialogTitle} id="admin-confirm-title">
          {request.title}
        </h2>
        <p className={styles.dialogEffect} id="admin-confirm-effect">
          {request.effect}
        </p>

        {request.reason && (
          <div className={styles.dialogField}>
            <label className={styles.fieldLabel} htmlFor="admin-confirm-reason">
              {request.reason.label}
              {request.reason.required && <span className={styles.required}> *</span>}
            </label>
            <textarea
              className="field"
              id="admin-confirm-reason"
              ref={reasonRef}
              rows={3}
              value={reason}
              placeholder={request.reason.placeholder}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        )}

        <div className={styles.dialogActions}>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            className={`btn ${request.danger ? styles.dangerButton : "btn-primary"}`}
            ref={confirmRef}
            type="button"
            onClick={() => void request.onConfirm(reason.trim())}
            disabled={busy || missingReason}
            title={missingReason ? "사유를 적어야 진행할 수 있습니다" : undefined}
          >
            {busy ? "처리 중…" : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
