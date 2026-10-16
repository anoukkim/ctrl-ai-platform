/**
 * Profile — 계정과 분기, 로그인 방법, 연결한 서비스.
 *
 * 분기 카드는 네 가지를 한눈에 보여 주는 것이 목적입니다.
 *   1. 지금 어느 분기인지
 *   2. 활동 회원인지
 *   3. 언제까지 쓸 수 있는지
 *   4. 지난 작업물이 그대로 남는지
 *
 * 전부 로그인한 회원 자신의 데이터입니다. 내가 만든 앱도 내가 게시한
 * 것만 읽습니다 (`/api/apps/mine`, owner-polish 3). 목업 데이터는 쓰지
 * 않습니다 (fix-beta-blockers, 2026-10-14).
 */

import type { Metadata } from "next";

import PageHeader from "@/app/components/PageHeader";

import { AccountSettings, Identity, NotificationSettings } from "./AccountIdentity";
import MyAppsSection from "./MyAppsSection";
import ProjectSummary from "./ProjectSummary";
import QuarterParticipation from "./QuarterParticipation";
import ConnectedAppsSection from "./ConnectedAppsSection";
import DefaultModelSection from "./DefaultModelSection";
import SignInMethodsSection from "./SignInMethodsSection";
import WithdrawalSection from "./WithdrawalSection";
import styles from "./profile.module.css";

export const metadata: Metadata = {
  title: "Profile — CTRL+AI",
};

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        subtitle="내 계정과 참여 분기, 지금까지 만든 결과물입니다."
      />

      <Identity />

      <QuarterParticipation />

      <div className={styles.columns}>
        <AccountSettings />

        <NotificationSettings />

        <DefaultModelSection />

        <SignInMethodsSection />

        <section className="card">
          <h2 className="section-title">연결한 서비스</h2>
          <div className={styles.connection}>
            <div>
              <p className={styles.connectionName}>GitHub 연결</p>
              <p className={styles.connectionHint}>
                만든 프로젝트를 내 저장소에 보관합니다.
              </p>
            </div>
            <span className={styles.connectionRight}>
              <span className="badge badge-muted">연결 안 됨</span>
              <button className="btn btn-sm" type="button" disabled title="Phase 4에서 제공됩니다">
                연결하기
              </button>
            </span>
          </div>
          <div className={styles.connection}>
            <div>
              <p className={styles.connectionName}>YouTube 연결</p>
              <p className={styles.connectionHint}>
                만든 영상을 내 채널에 올립니다. 연결할 때 같은 Google 계정에 업로드 권한을
                따로 물어봅니다.
              </p>
            </div>
            <span className={styles.connectionRight}>
              <span className="badge badge-muted">연결 안 됨</span>
              <button className="btn btn-sm" type="button" disabled title="Phase 7에서 제공됩니다">
                연결하기
              </button>
            </span>
          </div>
          <p className="small dim" style={{ marginTop: "0.6rem" }}>
            CTRL+AI는 GitHub나 Google의 비밀번호·토큰을 붙여 넣어 달라고 하지 않습니다.
          </p>
        </section>
      </div>

      <div className={styles.lists}>
        <ConnectedAppsSection />
        <ProjectSummary />

        <MyAppsSection />

      </div>

      <WithdrawalSection />
    </>
  );
}
