/**
 * 회원 상세 — /admin/members/[id]
 *
 * `params`는 App Router에서 Promise이므로 값을 읽기 전에 await 합니다.
 */

import MemberDetailView from "./MemberDetailView";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminMemberPage({ params }: Props) {
  const { id } = await params;

  return <MemberDetailView userId={Number(id)} />;
}
