/**
 * 앱 상세 — /admin/apps/[id] (app-platform P4b).
 *
 * `params`는 App Router에서 Promise이므로 값을 읽기 전에 await 합니다.
 */

import AppDetailView from "./AppDetailView";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminAppPage({ params }: Props) {
  const { id } = await params;

  return <AppDetailView projectId={Number(id)} />;
}
