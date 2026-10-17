/**
 * Admin — 시스템 (/admin/system)
 *
 * 맨 위는 **연결 상태 한 줄** — 서버 · 데이터베이스 · 외부 서비스 네 곳을
 * 점 하나씩으로(ui-improvements B, 오너: "걍 연결상태를 전체적으로 health를
 * 보고 싶은데"). 그 아래는 전부 접는 섹션입니다: 한 번에 하나만 펼치고,
 * 펼친 것은 이 브라우저가 기억합니다.
 *
 * 서버와 외부 서비스를 따로 두는 이유는 고치는 방법이 전혀 다르기
 * 때문입니다 — 하나는 우리 서버를 다시 띄우는 일이고, 다른 하나는 키를
 * 바꾸거나 제공자가 복구되기를 기다리는 일입니다. 백엔드와 데이터베이스도
 * 따로 보여 줍니다: API는 떠 있는데 PostgreSQL만 죽은 상태와 둘 다 죽은
 * 상태는 서로 다른 문제입니다.
 */

import BackendStatus from "@/app/components/BackendStatus";
import PageHeader from "@/app/components/PageHeader";

import Fold, { FoldGroup } from "../components/Fold";
import { sectionLabel } from "../sections";
import BuilderEvalPanel from "./BuilderEvalPanel";
import ClaudePricingPanel from "./ClaudePricingPanel";
import FeaturePanel from "./FeaturePanel";
import HealthStrip from "./HealthStrip";
import ProviderPanel from "./ProviderPanel";

import styles from "../admin.module.css";

export default function AdminSystemPage() {
  return (
    <div className={styles.sections}>
      <PageHeader
        eyebrow="Admin"
        title={sectionLabel("system")}
        subtitle={
          <>
            CTRL+AI의 서버와 데이터베이스, 그리고 연결된 외부 서비스의 상태입니다.
          </>
        }
      />

      <HealthStrip />

      <FoldGroup screen="system">
        <Fold id="server" title="서버 상세" note="주소, 버전, 환경, 데이터베이스">
          <BackendStatus />
        </Fold>

        <Fold id="features" title="기능 열기" note="회원에게 열어 둘 기능. 바꾸면 감사 기록에 남습니다.">
          <FeaturePanel />
        </Fold>

        <Fold id="providers" title="외부 서비스" note="API 키는 백엔드에만 있습니다 — 이 화면에 나오지 않습니다">
          <ProviderPanel />
        </Fold>

        {/* 환율 · 채팅 한도(깊이 표 포함) · 서버 설정(.env) — 한 상태를 나눠 쓰므로
            판 하나가 접는 섹션 셋을 그립니다. */}
        <ClaudePricingPanel />

        <Fold
          id="builder-eval"
          title="빌더 점검"
          note="서버에서 직접 돌리는 실제 Claude 점검 — 관리자 지갑에서 차감"
        >
          <BuilderEvalPanel />
        </Fold>
      </FoldGroup>
    </div>
  );
}
