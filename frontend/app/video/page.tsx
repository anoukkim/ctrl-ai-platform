/**
 * Video Generator — 작업 공간 화면.
 *
 * Project Builder와 형제 같은 작업 공간입니다. AppShell이 `/video`를
 * 작업 공간 경로로 알고 있어 여백과 최대 너비를 없애 줍니다.
 */

import type { Metadata } from "next";

import VideoWorkspace from "./VideoWorkspace";

export const metadata: Metadata = {
  title: "Video Generator — Ctrl AI",
};

export default function VideoGeneratorPage() {
  return <VideoWorkspace />;
}
