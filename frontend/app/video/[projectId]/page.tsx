/**
 * Video Generator 작업 공간 — /video/[projectId]
 *
 * AppShell은 이 경로를 작업 공간으로 인식해 여백과 최대 너비를 없앱니다.
 */

import type { Metadata } from "next";

import VideoWorkspace from "./VideoWorkspace";

export const metadata: Metadata = {
  title: "Video Generator — Ctrl AI",
};

interface Props {
  params: Promise<{ projectId: string }>;
}

export default async function VideoProjectPage({ params }: Props) {
  const { projectId } = await params;

  return <VideoWorkspace projectId={projectId} />;
}
