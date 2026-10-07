/**
 * Project Builder — 프로젝트 목록 화면.
 *
 * 메인 내비게이션의 Project Builder는 이제 작업 공간이 아니라 이 목록을
 * 엽니다. 개별 작업 공간은 /builder/[projectId]에 있습니다.
 */

import type { Metadata } from "next";
import { Suspense } from "react";

import BuilderLibrary from "./BuilderLibrary";

export const metadata: Metadata = {
  title: "Project Builder — CTRL+AI",
};

export default function BuilderLibraryPage() {
  // 목록이 주소의 ?idea=(Chat의 액션 단추)를 읽으므로 Suspense로 감쌉니다.
  return (
    <Suspense fallback={<p className="small muted">불러오는 중…</p>}>
      <BuilderLibrary />
    </Suspense>
  );
}
