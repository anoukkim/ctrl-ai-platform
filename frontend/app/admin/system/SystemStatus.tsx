/**
 * Admin › System › 상태 (/admin/system; admin-ui-unify).
 *
 * 제목과 설명은 틀(`AdminFrame`)이 그립니다. 이 화면은 위에서부터:
 *
 * 1. **연결 상태 카드 줄** — 서버 · 데이터베이스 · 백업 · 썸네일 서버 ·
 *    외부 서비스를 한 번씩(`HealthStrip`). 서버와 외부 서비스를 따로 두는
 *    이유는 고치는 방법이 다르기 때문이에요 — 하나는 우리 서버를 다시 띄우는
 *    일, 다른 하나는 키를 바꾸거나 제공자가 복구되기를 기다리는 일. API는
 *    떠 있는데 PostgreSQL만 죽은 상태도 따로 보입니다.
 * 2. **설정 카드** — 기능 열기, 공지 띠, 알림 기준, 유지보수.
 * 3. **접는 묶음** — 환율 · 서버 설정(`ClaudePricingPanel`), 서버 상세,
 *    빌더 점검. 한 번에 하나만 펼치고, 이 브라우저가 기억합니다.
 */

import BackendStatus from "@/app/components/BackendStatus";

import { SettingsGrid, Stack } from "../components/AdminUI";
import Fold, { FoldGroup } from "../components/Fold";
import AlertsPanel from "./AlertsPanel";
import BannerPanel from "./BannerPanel";
import BuilderEvalPanel from "./BuilderEvalPanel";
import ClaudePricingPanel from "./ClaudePricingPanel";
import FeaturePanel from "./FeaturePanel";
import HealthStrip from "./HealthStrip";
import MaintenancePanel from "./MaintenancePanel";

export default function AdminSystemPage() {
  return (
    <Stack>
      <HealthStrip />

      <SettingsGrid>
        <FeaturePanel />
        <BannerPanel />
        <AlertsPanel />
        <MaintenancePanel />
      </SettingsGrid>

      <FoldGroup screen="system">
        {/* 환율 · 서버 설정(.env). 채팅 한도는 Models › 한도로 (admin-consolidation v3). */}
        <ClaudePricingPanel part="system" />

        <Fold id="server" title="서버 상세" note="주소, 버전, 환경, 데이터베이스">
          <BackendStatus />
        </Fold>

        <Fold id="builder-eval" title="빌더 점검" note="실제 Claude 점검 — 관리자 지갑에서 차감">
          <BuilderEvalPanel />
        </Fold>
      </FoldGroup>
    </Stack>
  );
}
