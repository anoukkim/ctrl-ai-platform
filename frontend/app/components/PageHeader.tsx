/**
 * 목록 화면의 머리말 — 시안 그대로: 머리표(● Create), 제목, 설명,
 * 오른쪽의 주요 단추, 그리고 아래 구분선.
 *
 * 모든 화면(Project Builder, Video Generator, CtrlAIApps, CtrlAITube,
 * Usage, Profile, Admin)이 이 하나를 씁니다. 화면마다 머리말을 따로
 * 그리면 크기와 간격이 조금씩 어긋나기 때문입니다. 모양은 globals.css의
 * `.page-header`가 정합니다.
 *
 * Server Component입니다 — 상태가 없습니다.
 */

import type { ReactNode } from "react";

export type EyebrowTone = "build" | "video" | "accent";

const TONE_CLASS: Record<EyebrowTone, string> = {
  build: "page-eyebrow page-eyebrow-build",
  video: "page-eyebrow page-eyebrow-video",
  accent: "page-eyebrow",
};

export default function PageHeader({
  eyebrow,
  tone = "accent",
  title,
  titleAddon,
  subtitle,
  actions,
  id,
}: {
  /** 사이드바 묶음 이름 — Create, Explore, Account, Admin. */
  eyebrow?: string;
  tone?: EyebrowTone;
  title: ReactNode;
  /** 제목 바로 옆의 작은 것(준비 중 배지 등). */
  titleAddon?: ReactNode;
  subtitle?: ReactNode;
  /** 오른쪽: 주요 단추, 개수 같은 것. */
  actions?: ReactNode;
  /** 제목의 id — 섹션이 aria-labelledby로 가리킬 때. */
  id?: string;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow && <span className={TONE_CLASS[tone]}>{eyebrow}</span>}
        <h1 className="page-title" id={id}>
          {title}
          {titleAddon}
        </h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
