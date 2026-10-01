/**
 * Video Generator 작업 공간 — /video/[projectId]
 *
 * AppShell은 이 경로를 작업 공간으로 인식해 여백과 최대 너비를 없앱니다.
 */

import type { Metadata } from "next";

import VideoWorkspace from "./VideoWorkspace";

export const metadata: Metadata = {
  title: "Video Generator — CTRL+AI",
};

interface Props {
  params: Promise<{ projectId: string }>;
}

export default async function VideoProjectPage({ params }: Props) {
  const { projectId } = await params;

  // projectId마다 다른 key를 줍니다. 작업 공간을 갈아탈 때 React가 앞
  // 프로젝트의 인스턴스를 재사용하지 않고 새로 만들게 하려는 것으로,
  // 한 인스턴스가 보는 프로젝트가 도중에 바뀌지 않는다는 뜻입니다.
  // VideoWorkspace의 불러오기는 그 보장 위에 서 있습니다.
  return <VideoWorkspace key={projectId} projectId={projectId} />;
}
