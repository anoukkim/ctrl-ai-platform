/**
 * Admin — 시스템 (/admin/system)
 *
 * 백엔드와 데이터베이스가 살아 있는지 봅니다. 둘을 따로 보여 주는 이유는
 * `/api/health`가 그렇게 돌려주기 때문입니다: API는 떠 있는데 PostgreSQL만
 * 죽은 상태와 둘 다 죽은 상태는 고치는 방법이 다릅니다.
 */

import BackendStatus from "@/app/components/BackendStatus";

export default function AdminSystemPage() {
  return (
    <>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">시스템</h1>
        <p className="page-subtitle">
          백엔드와 데이터베이스의 상태입니다. 둘을 따로 보여 주므로, 어느 쪽이 멈췄는지
          바로 알 수 있습니다.
        </p>
      </header>

      <BackendStatus />
    </>
  );
}
