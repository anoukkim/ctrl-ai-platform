"use client";

/**
 * 모든 창의 바깥 껍데기: 어두운 배경과 가운데의 판.
 *
 * **`document.body`에 그립니다(portal).** 창을 연 단추가 어디에 있든 —
 * 베타 배너, 사이드바 아래, 표의 한 줄 — 같은 모양이어야 하기 때문입니다.
 * 예전에는 창이 단추 옆에 그려져 부모의 글꼴과 줄바꿈을 물려받았고, 베타
 * 배너(`white-space: nowrap`) 안에서 연 의견 보내기 창은 글이 줄바꿈되지
 * 않아 입력칸과 보내기 단추가 오른쪽으로 삐져나갔습니다
 * (fix-ui-polish-admin).
 *
 * 안쪽 여백과 너비는 여기서 한 번만 정합니다. 창마다 다른 것은 내용뿐입니다.
 */

import { createPortal } from "react-dom";

import styles from "./confirm-dialog.module.css";

interface Props {
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  children: React.ReactNode;
}

export default function DialogShell({ onClose, labelledBy, describedBy, children }: Props) {
  const content = (
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
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {children}
      </div>
    </div>
  );

  // 창은 누른 뒤에만 열리므로 서버에서 그릴 일은 없지만, 혹시 그렇다면
  // 제자리에 그립니다.
  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
