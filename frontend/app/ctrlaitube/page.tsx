/**
 * CtrlAITube — 커뮤니티 영상 피드.
 *
 * CTRL+AI는 영상을 직접 보관하지 않습니다. 게시된 영상은 만든 사람의
 * YouTube 채널에 올라가 있고, 여기에서는 YouTube 영상 ID로 불러와 보여 줍니다.
 *
 * 아래 썸네일은 이미지를 내려받지 않고 CSS로 그립니다. 그래서 외부 연결
 * 없이도 화면이 정상적으로 보입니다.
 */

import type { Metadata } from "next";
import { MOCK_VIDEOS } from "@/lib/mock-data";

import VideoGrid from "./VideoGrid";

export const metadata: Metadata = {
  title: "CtrlAITube — CTRL+AI",
};

export default function CtrlAITubePage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          CtrlAITube <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          회원들이 만들어 자기 YouTube 채널에 올린 영상입니다. 여기에서 나누는 이야기는
          CTRL+AI 안에만 쌓입니다.
        </p>
        <span className="badge badge-muted">{MOCK_VIDEOS.length}개</span>
      </header>

      <VideoGrid />
    </>
  );
}
