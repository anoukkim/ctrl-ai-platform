/**
 * Video Generator — 영상 프로젝트 목록 화면.
 *
 * 메인 내비게이션의 Video Generator는 작업 공간이 아니라 이 목록을
 * 엽니다. 개별 작업 공간은 /video/[projectId]에 있습니다.
 */

import type { Metadata } from "next";
import { Suspense } from "react";

import VideoLibrary from "./VideoLibrary";

export const metadata: Metadata = {
  title: "Video Generator — CTRL+AI",
};

export default function VideoLibraryPage() {
  // 목록이 주소의 ?idea=(Chat의 액션 단추)를 읽으므로 Suspense로 감쌉니다.
  return (
    <Suspense fallback={<p className="small muted">불러오는 중…</p>}>
      <VideoLibrary />
    </Suspense>
  );
}
