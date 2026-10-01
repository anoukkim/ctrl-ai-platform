/**
 * Admin 대시보드 — /admin
 *
 * Admin의 현관입니다. 두 가지만 합니다: 손이 필요한 일을 위에 올리고,
 * 나머지 구역으로 보내 줍니다.
 *
 * 숫자를 카드에 함께 적는 이유: 들어가 보기 전에 들어갈 이유가 있는지
 * 알 수 있어야 합니다. "충전 신청"만 적혀 있으면 매번 눌러서 비어 있는
 * 것을 확인해야 합니다.
 */

import AdminDashboard from "./AdminDashboard";

export default function AdminPage() {
  return <AdminDashboard />;
}
