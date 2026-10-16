/**
 * CtrlAITube — 커뮤니티 영상 피드.
 *
 * 지금 목록에 있는 것은 CTRL+AI의 소개 영상(공식, 9:16 세로 편)뿐입니다 —
 * CTRL+AI가 직접 서빙하는 파일이라 여기서 바로 재생되고, 반응과 댓글이
 * 저장됩니다. 회원들의 영상은 만든 사람의 YouTube 채널에 올라가고
 * 여기에는 YouTube 영상 ID로 들어옵니다(Phase 8). 예시 카드와 "테스트
 * 모드" 꼬리표는 fix-promo-video-placement(2026-10-16)에서 지웠습니다 —
 * 목록에 실제가 아닌 것은 없습니다.
 */

import type { Metadata } from "next";

import PageHeader from "@/app/components/PageHeader";

import VideoGrid from "./VideoGrid";

export const metadata: Metadata = {
  title: "CtrlAITube — CTRL+AI",
};

export default function CtrlAITubePage() {
  return (
    <>
      <PageHeader
        eyebrow="Explore"
        title="CtrlAITube"
        subtitle={
          <>
            CTRL+AI 소개 영상을 여기서 바로 볼 수 있어요. 회원들이 만들어 자기 YouTube 채널에
            올린 영상도 이 자리에 모이고, 여기에서 나누는 이야기는 CTRL+AI 안에만 쌓입니다.
          </>
        }
      />

      <VideoGrid />
    </>
  );
}
