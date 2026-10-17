"use client";

/**
 * 구역 안의 탭 하나를 그립니다 (admin-consolidation v3). 탭 줄 자체는
 * `AdminFrame`이 그리고, 여기는 주소의 `?tab=`에 맞는 화면만 고릅니다.
 */

import { useSearchParams } from "next/navigation";

import { ADMIN_SECTIONS, activeTab } from "./sections";

export default function SectionPanels({
  section,
  panels,
}: {
  section: string;
  panels: Record<string, React.ReactNode>;
}) {
  const params = useSearchParams();
  const found = ADMIN_SECTIONS.find((candidate) => candidate.key === section);
  if (!found) return null;
  return <>{panels[activeTab(found, params.get("tab")).key]}</>;
}
