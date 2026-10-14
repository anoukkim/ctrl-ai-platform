/**
 * CtrlAIApps — 회원들이 만든 앱을 모아 보는 곳 (ctrlaiapps-publish).
 *
 * Project Builder의 프로젝트는 혼자 작업하는 공간이고, 여기에 올라온
 * 앱은 만든 사람이 고른 "게시된 버전"입니다.
 */

import type { Metadata } from "next";

import PageHeader from "@/app/components/PageHeader";

import AppGrid from "./AppGrid";

export const metadata: Metadata = {
  title: "CtrlAIApps — CTRL+AI",
};

export default function CtrlAIStorePage() {
  return (
    <>
      <PageHeader
        eyebrow="Explore"
        title="CtrlAIApps"
        subtitle={
          <>
            회원들이 Project Builder로 만들어 게시한 앱입니다. 앱은 방문한 사람의 브라우저에서만
            돌아가고, 저장한 내용은 그 사람 기기에만 남아요.
          </>
        }
      />

      <AppGrid />
    </>
  );
}
