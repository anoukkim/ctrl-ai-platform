"use client";

/**
 * 사진 크게 보기 — 썸네일을 누르면 화면 가운데에 크게 띄웁니다.
 *
 * Admin › Feedback의 스크린샷(feedback-screenshots)이 처음 씁니다. 여러 장이면
 * ← →로 넘기고, Esc·바깥 누르기·닫기로 닫습니다. `document.body`에 그립니다.
 */

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./image-lightbox.module.css";

export interface LightboxImage {
  src: string;
  /** 사진 이름 — 캡션과 대체 글. */
  name: string;
  /** "1.2MB · 1440×900" 같은 한 줄. */
  note?: string;
}

interface Props {
  images: LightboxImage[];
  /** 처음 보여 줄 사진. */
  index: number;
  onClose: () => void;
}

export default function ImageLightbox({ images, index, onClose }: Props) {
  const [at, setAt] = useState(Math.min(Math.max(index, 0), images.length - 1));
  const captionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const image = images[at];

  // 키보드와 낭독기가 뒤의 표에 남지 않도록: 열리면 닫기 단추로, 닫히면
  // 열었던 썸네일로 초점을 돌려 둡니다.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setAt((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setAt((current) => Math.min(images.length - 1, current + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [images.length, onClose]);

  if (!image || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="사진 크게 보기"
      aria-describedby={captionId}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button className={styles.close} ref={closeRef} type="button" onClick={onClose} aria-label="닫기">
        <X size={20} aria-hidden="true" />
      </button>
      {images.length > 1 && (
        <button
          className={`${styles.nav} ${styles.prev}`}
          type="button"
          onClick={() => setAt((current) => Math.max(0, current - 1))}
          disabled={at === 0}
          aria-label="이전 사진"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- 백엔드가 주는 회원 사진 */}
      <img className={styles.image} src={image.src} alt={image.name} />
      {images.length > 1 && (
        <button
          className={`${styles.nav} ${styles.next}`}
          type="button"
          onClick={() => setAt((current) => Math.min(images.length - 1, current + 1))}
          disabled={at === images.length - 1}
          aria-label="다음 사진"
        >
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      )}
      <p className={styles.caption} id={captionId}>
        {images.length > 1 && <span className={styles.count}>{at + 1} / {images.length}</span>}
        <span>{image.name}</span>
        {image.note && <span className={styles.note}>{image.note}</span>}
      </p>
    </div>,
    document.body,
  );
}
