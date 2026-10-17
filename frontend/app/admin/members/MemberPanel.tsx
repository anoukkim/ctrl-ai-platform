"use client";

/**
 * 회원 상세를 오른쪽 판으로 (admin-consolidation v3, owner 2026-10-17).
 *
 * 목록에서 줄을 누르면 목록은 그대로 두고 오른쪽에 그 회원의 모든 일 —
 * 지원금 ± 조정, 참여 상태, 역할, 탈퇴, 지운 작업 복구, 기록 — 이 열립니다.
 * Esc나 바깥을 누르면 닫히고, "전체 화면으로"는 예전 회원 상세 주소예요.
 */

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import MemberDetailView from "./[id]/MemberDetailView";

import styles from "../admin.module.css";

export default function MemberPanel({
  userId,
  onClose,
  fullHref,
  onChanged,
}: {
  userId: number;
  onClose: () => void;
  fullHref: string;
  onChanged?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role='dialog'][aria-modal='true']:not([data-member-panel])")) {
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <>
      <div className={styles.panelScrim} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className={styles.memberPanel}
        role="dialog"
        aria-modal="false"
        aria-label="회원 상세"
        data-member-panel=""
        tabIndex={-1}
        data-testid="member-panel"
      >
        <div className={styles.memberPanelBar}>
          <Link className="btn btn-sm" href={fullHref}>
            전체 화면으로
          </Link>
          <button type="button" className={styles.memberPanelClose} aria-label="닫기" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <MemberDetailView userId={userId} embedded onChanged={onChanged} />
      </div>
    </>
  );
}
