/**
 * 앱 상세 화면 (ctrlaiapps-publish).
 *
 * 이름 · 설명 · 만든 사람 · 판 번호와 업데이트 메모, 그리고 **앱 실행**
 * 하나. 아래에는 그 앱을 앱 주소(apps.ctrlai.my) 그대로 샌드박스 안에서
 * 돌려 보여 주고, 문제가 있으면 신고할 수 있습니다.
 *
 * App Router에서 `params`는 Promise이므로 값을 읽기 전에 await 해야 합니다.
 */

import type { Metadata } from "next";

import AppDetail from "./AppDetail";

interface AppDetailProps {
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = { title: "CtrlAIApps — CTRL+AI" };

export default async function AppDetailPage({ params }: AppDetailProps) {
  const { slug } = await params;
  return <AppDetail slug={slug} />;
}
