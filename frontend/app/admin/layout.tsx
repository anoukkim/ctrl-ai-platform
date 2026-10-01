/**
 * Admin 레이아웃 — 모든 /admin 경로가 같은 틀을 씁니다.
 *
 * 레이아웃에 두는 이유는 두 가지입니다. 구역을 옮겨도 틀이 다시 그려지지
 * 않아 탭이 깜빡이지 않고, 고른 분기가 화면을 옮겨도 살아 있습니다.
 *
 * `AdminQuarterProvider`가 주소의 `?quarter=`를 읽으므로 Suspense로
 * 감쌉니다. Next는 주소의 질의 문자열을 읽는 클라이언트 컴포넌트에
 * 경계를 요구합니다 — 그 위쪽은 미리 그려 두고 이 안쪽만 브라우저에서
 * 그리기 위해서입니다.
 */

import type { Metadata } from "next";
import { Suspense } from "react";

import AdminFrame from "./AdminFrame";
import AdminQuarterProvider from "./AdminQuarterProvider";

export const metadata: Metadata = {
  title: "Admin — CTRL+AI",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="small muted">Admin을 불러오는 중…</p>}>
      <AdminQuarterProvider>
        <AdminFrame>{children}</AdminFrame>
      </AdminQuarterProvider>
    </Suspense>
  );
}
