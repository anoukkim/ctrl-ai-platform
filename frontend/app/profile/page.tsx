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
import ServiceConnections from "./ServiceConnections";
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

        <ServiceConnections />
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
