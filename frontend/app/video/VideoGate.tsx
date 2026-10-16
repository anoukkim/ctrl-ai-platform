"use client";

/**
 * Video Generator의 잠금 (owner-polish 6).
 *
 * 영상은 다음 단계에 시작합니다. 관리자가 Admin › System에서 스위치를 켤
 * 때까지 이 영역 전체가 잠겨 있고, 화면은 오너가 정한 모양 그대로입니다
 * (2026-10-16): "가운데에 자물쇠 하나 걸어두고 다음 phase에 impl 예정이라고".
 * 목록도 검색도 새 프로젝트 단추도 없이, 자물쇠 하나와 짧은 안내만.
 * 관리자에게는 같은 화면에 "Admin › System에서 열 수 있어요" 한 줄이 더.
 *
 * 실제 차단은 백엔드의 `require_video_open`이 합니다 — 여기서는 잠긴
 * 화면을 보여 줄 뿐입니다.
 */

import { Lock } from "lucide-react";
import Link from "next/link";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import { useSite } from "@/app/components/SiteProvider";
import { VIDEO_LOCKED_HINT } from "@/lib/site";

import styles from "./video-lock.module.css";

export default function VideoGate({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const { state } = useCurrentUser();
  const isAdmin = state.phase === "authenticated" && state.user.is_admin;

  if (site.video_open) return <>{children}</>;

  return (
    <div className={styles.lock} role="status" data-testid="video-locked">
      <span className={styles.lockIcon} aria-hidden="true">
        <Lock size={34} strokeWidth={1.6} />
      </span>
      <p className={styles.title}>Video Generator는 {VIDEO_LOCKED_HINT}</p>
      <p className={styles.text}>지금은 준비 중이에요. 열리면 메뉴의 자물쇠가 사라져요.</p>
      {isAdmin && (
        <p className={styles.admin} data-testid="video-admin-locked-notice">
          관리자: <Link href="/admin/system">Admin › System</Link>에서 열 수 있어요.
        </p>
      )}
    </div>
  );
}
