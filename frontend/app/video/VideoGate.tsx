"use client";

/**
 * Video Generator의 잠금 (owner-polish 6).
 *
 * 영상은 다음다음 분기에 시작합니다. 그때까지 관리자가 Admin › System에서
 * 스위치를 켤 때까지 회원에게는 이 영역 전체가 잠겨 있고, 화면은 그 이유를
 * 한 문장으로 말합니다 — "다음 분기에 열려요". 실제 차단은 백엔드의
 * `require_video_open`이 합니다; 여기서는 잠긴 화면을 보여 줄 뿐입니다.
 *
 * 관리자는 잠겨 있어도 들어갑니다(공급자 연결을 미리 확인해 두려고). 그
 * 대신 회원에게는 잠겨 있다는 띠를 위에 둡니다.
 */

import { Lock } from "lucide-react";
import Link from "next/link";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import EmptyState from "@/app/components/EmptyState";
import PageHeader from "@/app/components/PageHeader";
import { useSite } from "@/app/components/SiteProvider";
import { VIDEO_LOCKED_HINT } from "@/lib/site";

export default function VideoGate({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const { state } = useCurrentUser();
  const isAdmin = state.phase === "authenticated" && state.user.is_admin;

  if (site.video_open) return <>{children}</>;

  if (isAdmin) {
    return (
      <>
        <p className="notice" role="status" data-testid="video-admin-locked-notice" style={{ marginBottom: "0.8rem" }}>
          <Lock size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: "0.35rem" }} />
          회원에게는 Video Generator가 잠겨 있어요 ({VIDEO_LOCKED_HINT}). 관리자만 보고 있는 화면입니다 —{" "}
          <Link href="/admin/system">Admin › System</Link>에서 열 수 있어요.
        </p>
        {children}
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Create"
        tone="video"
        title="Video Generator"
        subtitle="아이디어를 적고, 다듬고, 여러 번 만들어 보면서 마음에 드는 영상을 고릅니다."
      />
      <EmptyState
        icon={Lock}
        title={`Video Generator는 ${VIDEO_LOCKED_HINT}`}
        text="이번 분기에는 영상 만들기를 준비하는 중이에요. 열리면 메뉴의 자물쇠가 사라지고 여기서 바로 시작할 수 있어요. 그동안은 Chat과 Project Builder를 써 보세요."
        action={{ label: "Project Builder로 가기", href: "/builder" }}
      />
    </>
  );
}
