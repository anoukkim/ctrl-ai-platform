/**
 * Project Builder 작업 공간 — /builder/[projectId]
 *
 * `params`는 App Router에서 Promise이므로 값을 읽기 전에 await 합니다.
 * AppShell은 이 경로를 작업 공간으로 인식해 여백과 최대 너비를 없앱니다.
 */

import type { Metadata } from "next";

import BuilderWorkspace from "./BuilderWorkspace";

export const metadata: Metadata = {
  title: "Project Builder — CTRL+AI",
};

interface Props {
  params: Promise<{ projectId: string }>;
}

export default async function BuilderProjectPage({ params }: Props) {
  const { projectId } = await params;

  // projectId마다 다른 key를 줍니다 — 이유는 video/[projectId]/page.tsx와
  // 같습니다: 한 인스턴스가 보는 프로젝트를 하나로 고정합니다.
  return <BuilderWorkspace key={projectId} projectId={projectId} />;
}
