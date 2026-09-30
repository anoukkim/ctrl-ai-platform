/**
 * Video Generator — 영상 프로젝트 목록 화면.
 *
 * 메인 내비게이션의 Video Generator는 작업 공간이 아니라 이 목록을
 * 엽니다. 개별 작업 공간은 /video/[projectId]에 있습니다.
 */

import type { Metadata } from "next";

import VideoLibrary from "./VideoLibrary";

export const metadata: Metadata = {
  title: "Video Generator — Ctrl AI",
};

export default function VideoLibraryPage() {
  return <VideoLibrary />;
}
