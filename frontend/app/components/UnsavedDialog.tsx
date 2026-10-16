"use client";

/**
 * 저장 안 한 작업 앞의 세 갈래 창 (builder-snapshots): 저장 / 저장 안 함 /
 * 취소.
 *
 * 옛 버전을 불러올 때("저장 안 한 작업이 있어요. 저장할까요?")와 Builder를
 * 나갈 때("이 버전을 저장할까요?") 같은 창을 씁니다. 확인창
 * (`ConfirmDialog`)은 두 갈래라서 따로 두었고, 껍데기와 모양은 같은 것을
 * 씁니다. 저장하지 않아도 지운 것은 없습니다 — 파일은 실행 취소로 돌아올
 * 수 있어요(불러올 때). 나갈 때는 작업 중인 파일이 그대로 남아 있고요.
 */

import { useEffect, useRef } from "react";

import DialogShell from "./DialogShell";
import styles from "./confirm-dialog.module.css";

export interface UnsavedRequest {
  title: string;
  effect: string;
  /** "저장" — 저장한 뒤 하려던 일을 이어서 합니다. */
  onSave: () => void | Promise<void>;
  /** "저장 안 함" — 저장하지 않고 하려던 일을 합니다. */
  onDiscard: () => void | Promise<void>;
}

interface Props {
  request: UnsavedRequest | null;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}

export default function UnsavedDialog({ request, onClose, busy = false, error = null }: Props) {
  if (request === null) return null;
  return <Dialog request={request} onClose={onClose} busy={busy} error={error} />;
}

function Dialog({
  request,
  onClose,
  busy,
  error,
}: {
  request: UnsavedRequest;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}) {
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    saveRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  return (
    <DialogShell onClose={onClose} labelledBy="unsaved-dialog-title" describedBy="unsaved-dialog-effect">
      <h2 className={styles.dialogTitle} id="unsaved-dialog-title">
        {request.title}
      </h2>
      <p className={styles.dialogEffect} id="unsaved-dialog-effect">
        {request.effect}
      </p>
      {error && (
        <p className={styles.dialogError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button className="btn" type="button" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button className="btn" type="button" onClick={() => void request.onDiscard()} disabled={busy}>
          저장 안 함
        </button>
        <button
          className="btn btn-primary"
          ref={saveRef}
          type="button"
          onClick={() => void request.onSave()}
          disabled={busy}
        >
          {busy ? "처리 중…" : "저장"}
        </button>
      </div>
    </DialogShell>
  );
}
