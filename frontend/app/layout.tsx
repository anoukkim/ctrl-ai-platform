import type { Metadata } from "next";

import AdminNavProvider from "@/app/components/AdminNavProvider";
import AppShell from "@/app/components/AppShell";
import CurrentUserProvider from "@/app/components/CurrentUserProvider";
import MyQuarterProvider from "@/app/components/MyQuarterProvider";

import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

// Pretendard Variable — 시안의 글꼴. 패키지 안의 woff2를 Next가 함께
// 내려 주므로 외부 CDN에 기대지 않습니다. dynamic-subset은 화면에 나온
// 한글 범위의 파일만 받습니다.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "CTRL+AI",
  description:
    "CTRL+AI — 함께 만들고 함께 나누는 AI 창작 커뮤니티. 이야기하듯 앱을 만들고 영상을 만들어 공유하세요.",
};

// `children` is typed explicitly rather than with Next's generated
// `LayoutProps` helper, so `npx tsc --noEmit` also works on a fresh
// checkout where `.next/types` has not been generated yet.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme은 기본값(어둡게)이고, 아래 스크립트가 그리기 전에 회원이
    // 고른 값으로 바꿉니다. 서버가 그린 값과 달라지는 것이 정상이라
    // suppressHydrationWarning을 둡니다.
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <CurrentUserProvider>
          <MyQuarterProvider>
            {/* 사이드바의 Admin 묶음이 쓰는 숫자. 관리자가 아니면 아무것도
                부르지 않습니다. */}
            <AdminNavProvider>
              <AppShell>{children}</AppShell>
            </AdminNavProvider>
          </MyQuarterProvider>
        </CurrentUserProvider>
      </body>
    </html>
  );
}
