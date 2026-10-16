"use client";

/**
 * 게시 메뉴 › 썸네일 바꾸기 (owner-polish-3 (a2)) — 게시한 뒤에도 같은 고르개로.
 */

import { useId, useState } from "react";

import DialogShell from "@/app/components/DialogShell";
import styles from "@/app/components/confirm-dialog.module.css";

import ThumbnailPicker, { type ThumbnailCapture } from "./ThumbnailPicker";

interface Props {
  capture: ThumbnailCapture;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (image: Blob) => void;
}

export default function ThumbnailDialog({ capture, busy, error, onClose, onConfirm }: Props) {
  const [image, setImage] = useState<Blob | null>(null);
  const id = useId();
  return (
    <DialogShell onClose={onClose} labelledBy={`${id}-title`} describedBy={`${id}-effect`}>
      <h2 className={styles.dialogTitle} id={`${id}-title`}>
        썸네일 바꾸기
      </h2>
      <p className={styles.dialogEffect} id={`${id}-effect`}>
        미리보기에서 찍은 후보 가운데 고르거나, 지금 보이는 화면을 그대로 찍어요. 고른 그림이 CtrlAIApps와 Builder
        카드에 쓰여요. 비용은 들지 않아요.
      </p>
      <ThumbnailPicker capture={capture} value={image} onChange={(blob) => setImage(blob)} disabled={busy} />
      {error && (
        <p className={styles.dialogError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button className="btn" type="button" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button className="btn btn-primary" type="button" onClick={() => image && onConfirm(image)} disabled={busy || !image}>
          {busy ? "저장하는 중…" : "이 그림으로"}
        </button>
      </div>
    </DialogShell>
  );
}
