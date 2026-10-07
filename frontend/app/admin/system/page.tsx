/**
 * Admin — 시스템 (/admin/system)
 *
 * 두 묶음입니다. 위는 CTRL+AI 자신(백엔드와 데이터베이스), 아래는 바깥에
 * 기대고 있는 서비스들입니다. 둘을 나눠 두는 이유는 고치는 방법이 전혀
 * 다르기 때문입니다 — 하나는 우리 서버를 다시 띄우는 일이고, 다른 하나는
 * 키를 바꾸거나 제공자가 복구되기를 기다리는 일입니다.
 *
 * 백엔드와 데이터베이스도 따로 보여 줍니다. `/api/health`가 그렇게
 * 돌려주기 때문입니다: API는 떠 있는데 PostgreSQL만 죽은 상태와 둘 다
 * 죽은 상태는 서로 다른 문제입니다.
 */

import BackendStatus from "@/app/components/BackendStatus";

import ClaudePricingPanel from "./ClaudePricingPanel";
import ProviderPanel from "./ProviderPanel";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

export default function AdminSystemPage() {
  return (
    <div className={styles.sections}>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">{sectionLabel("system")}</h1>
        <p className="page-subtitle">
          CTRL+AI의 서버와 데이터베이스, 그리고 연결된 외부 서비스의 상태입니다.
        </p>
      </header>

      <section aria-labelledby="admin-server">
        <h2 className="section-title" id="admin-server">
          서버
        </h2>
        <BackendStatus />
      </section>

      <ProviderPanel />

      <ClaudePricingPanel />
    </div>
  );
}
