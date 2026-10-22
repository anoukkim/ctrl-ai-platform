"use client";

/**
 * 회원 상세를 오른쪽 판으로 (admin-consolidation v3, owner 2026-10-17;
 * admin-ui-unify: the kit's `SidePanel`).
 *
 * 목록에서 줄을 누르면 목록은 그대로 두고 오른쪽에 그 회원의 모든 일 —
 * 지원금 ± 조정, 참여 상태, 역할, 탈퇴, 지운 작업 복구, 기록 — 이 열립니다.
 * Esc나 바깥을 누르면 닫히고, "전체 화면으로"는 예전 회원 상세 주소예요.
 * 판(제목에 회원 이름)은 `MemberDetailView`가 그립니다 — 이름을 아는 것이
 * 그쪽이라서요.
 */

import MemberDetailView from "./[id]/MemberDetailView";

export default function MemberPanel({
  userId,
  onClose,
  fullHref,
  onChanged,
}: {
  userId: number;
  onClose: () => void;
  fullHref: string;
  onChanged?: () => void;
}) {
  return <MemberDetailView key={userId} userId={userId} panel={{ onClose, fullHref }} onChanged={onChanged} />;
}
