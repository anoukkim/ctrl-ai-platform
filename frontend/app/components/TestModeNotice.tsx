"use client";

/**
 * "테스트 모드 – 실제 AI 결과가 아닙니다".
 *
 * 배포된 사이트에서 아직 목업 제공자로 도는 화면에 붙습니다. 화면은 그대로
 * 쓸 수 있지만, 회원이 목업의 답을 진짜 AI의 결과로 오해하지 않게
 * 합니다(prep-beta-launch). 개발 환경에서는 붙지 않습니다 — 모두가 목업인
 * 것을 압니다. 붙일지는 백엔드가 정합니다(`/api/site`의 `test_mode`).
 */

import { FlaskConical } from "lucide-react";

import { TEST_MODE_LABEL, type TestModeArea } from "@/lib/site";

import { useSite } from "./SiteProvider";

export default function TestModeNotice({
  area,
  className,
}: {
  area: TestModeArea;
  className?: string;
}) {
  const { test_mode } = useSite();
  if (!test_mode[area]) return null;

  return (
    <span className={`badge badge-warn test-mode ${className ?? ""}`} role="note" data-testid="test-mode">
      <FlaskConical size={12} aria-hidden="true" />
      {TEST_MODE_LABEL[area]}
    </span>
  );
}
