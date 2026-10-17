"use client";

/**
 * 전체 화면 미리보기 (chat-preview-fullscreen).
 *
 * 채팅 미리보기 카드의 "전체 화면"이 여는 창 — 거의 화면 전체를 쓰고, 어두운
 * 배경, 닫기와 Esc, 새로고침, 폰/데스크톱 너비. 브라우저의 Fullscreen API가
 * 아니라 페이지 안의 창입니다: 틀은 `sandbox="allow-scripts"`만 가진 채로
 * 둡니다(allow-fullscreen 없음). 이미 열린 카드의 틀은 옮기면 다시 불러오게
 * 되므로, 같은 srcdoc으로 새 틀을 하나 띄웁니다. 닫으면 틀이 사라집니다 —
 * 누르기 전에는 아무것도 돌지 않아요. 휴대폰 너비에서는 화면 전체 시트.
 */

import { Monitor, RotateCcw, Smartphone, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./preview-fullscreen.module.css";

interface Props {
  title: string;
  srcDoc: string;
  sandbox: string;
  label: string;
  onClose: () => void;
}

export default function PreviewFullscreen({ title, srcDoc, sandbox, label, onClose }: Props) {
  const titleId = useId();
  const [version, setVersion] = useState(0);
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  const content = (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="preview-fullscreen"
    >
      <div className={styles.window} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.head}>
          <span className={styles.title} id={titleId}>
            {title}
          </span>
          <span className={styles.tools}>
            <span className={styles.widths} role="group" aria-label="너비">
              <button
                type="button"
                className={`${styles.button} ${width === "desktop" ? styles.on : ""}`}
                aria-pressed={width === "desktop"}
                onClick={() => setWidth("desktop")}
                title="데스크톱 너비"
              >
                <Monitor size={13} aria-hidden="true" /> 데스크톱
              </button>
              <button
                type="button"
                className={`${styles.button} ${width === "phone" ? styles.on : ""}`}
                aria-pressed={width === "phone"}
                onClick={() => setWidth("phone")}
                title="폰 너비 (390px)"
              >
                <Smartphone size={13} aria-hidden="true" /> 폰
              </button>
            </span>
            <button type="button" className={styles.button} onClick={() => setVersion((v) => v + 1)}>
              <RotateCcw size={13} aria-hidden="true" /> 새로고침
            </button>
            <button ref={closeRef} type="button" className={styles.button} onClick={onClose} aria-label="닫기 (Esc)">
              <X size={13} aria-hidden="true" /> 닫기
            </button>
          </span>
        </div>
        <p className={styles.label}>{label}</p>
        <div className={styles.stage}>
          <iframe
            key={version}
            className={`${styles.frame} ${width === "phone" ? styles.framePhone : ""}`}
            title={`${title} — 전체 화면`}
            sandbox={sandbox}
            srcDoc={srcDoc}
            referrerPolicy="no-referrer"
            data-testid="preview-fullscreen-frame"
          />
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
