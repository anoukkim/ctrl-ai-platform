/**
 * Project Builder 작업 공간 — /builder/[projectId]
 *
 * `params`는 App Router에서 Promise이므로 값을 읽기 전에 await 합니다.
 * AppShell은 이 경로를 작업 공간으로 인식해 여백과 최대 너비를 없앱니다.
 */

import type { Metadata } from "next";

import BuilderWorkspace from "./BuilderWorkspace";

export const metadata: Metadata = {
  title: "Project Builder — Ctrl AI",
};

interface Props {
  params: Promise<{ projectId: string }>;
}

export default async function BuilderProjectPage({ params }: Props) {
  const { projectId } = await params;

  return <BuilderWorkspace projectId={projectId} />;
}
