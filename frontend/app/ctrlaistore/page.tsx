/**
 * CtrlAIApps — 회원들이 만든 앱을 모아 보는 곳 (ctrlaiapps-publish).
 *
 * Project Builder의 프로젝트는 혼자 작업하는 공간이고, 여기에 올라온
 * 앱은 만든 사람이 고른 "게시된 버전"입니다.
 */

import Link from "next/link";
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
          /* owner-polish-3 (d): 기기에만 남던 때의 글을 지금에 맞게 — 앱이 할 수
             있는 것만 말합니다(ctrlai.storage는 기기에, ctrlai.db는 CTRL+AI에,
             AI는 쓰는 사람의 지원금에서, 데모는 0원). */
          <>
            회원들이 Project Builder로 만들어 게시한 앱이에요. 앱 안의 AI는 로그인한 활동 회원이 버튼을
            누를 때만 자기 이번 분기 지원금에서 나가고, 「데모」인 앱은 AI를 부르지 않고 미리 준비한
            답을 보여 줘요. 게시판·투표처럼 앱이 CTRL+AI에 저장하는 글은 다른 기기에서도 보이고, 앱이
            기기에만 저장하는 것은 그 브라우저에만 남아요.{" "}
            <Link href="/help/apps">자세히</Link>
          </>
        }
      />

      <AppGrid />
    </>
  );
}
