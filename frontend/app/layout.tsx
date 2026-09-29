import type { Metadata } from "next";

import AppShell from "@/app/components/AppShell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Ctrl AI",
  description:
    "누구나 쉽게 시작하는 AI 창작 커뮤니티. 이야기하듯 앱을 만들고 영상을 만들어 공유하세요.",
};

// `children` is typed explicitly rather than with Next's generated
// `LayoutProps` helper, so `npx tsc --noEmit` also works on a fresh
// checkout where `.next/types` has not been generated yet.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
