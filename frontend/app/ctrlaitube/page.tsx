/**
 * CtrlAITube — 커뮤니티 영상 피드.
 *
 * CTRL+AI는 영상을 직접 보관하지 않습니다. 게시된 영상은 만든 사람의
 * YouTube 채널에 올라가 있고, 여기에서는 YouTube 영상 ID로 불러와 보여 줍니다.
 *
 * 아래 썸네일은 이미지를 내려받지 않고 CSS로 그립니다. 그래서 외부 연결
 * 없이도 화면이 정상적으로 보입니다.
 *
 * promo-videos: CTRL+AI의 소개 영상은 예외 — CTRL+AI가 직접 서빙하는
 * 파일이라 여기서 바로 재생되고, 반응과 댓글이 저장됩니다. 맨 앞 카드입니다.
 */

import type { Metadata } from "next";

import PageHeader from "@/app/components/PageHeader";
import TestModeNotice from "@/app/components/TestModeNotice";

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
        titleAddon={
          <>
            <span className="badge badge-mock">준비 중</span>
            <TestModeNotice area="community" />
          </>
        }
        subtitle={
          <>
            CTRL+AI 소개 영상은 여기서 바로 볼 수 있어요. 회원들이 만들어 자기 YouTube 채널에
            올린 영상도 이 자리에 모이고, 여기에서 나누는 이야기는 CTRL+AI 안에만 쌓입니다.
          </>
        }
      />

      <VideoGrid />
    </>
  );
}
