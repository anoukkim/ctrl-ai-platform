/**
 * Profile — 계정과 분기, 로그인 방법, 연결한 서비스 (일부 목업).
 *
 * 분기 카드는 네 가지를 한눈에 보여 주는 것이 목적입니다.
 *   1. 지금 어느 분기인지
 *   2. 활동 회원인지
 *   3. 언제까지 쓸 수 있는지
 *   4. 지난 작업물이 그대로 남는지
 *
 * 날짜 계산은 lib/mock-data.ts의 QUARTER_RANGE 하나만 보고 합니다. 실제
 * 분기 기능이 생기면 그 값만 바꾸면 됩니다.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { MOCK_APPS } from "@/lib/mock-data";

import EmptyState from "@/app/components/EmptyState";
import PageHeader from "@/app/components/PageHeader";
import { LayoutGrid } from "lucide-react";

import { AccountSettings, Identity } from "./AccountIdentity";
import ProjectSummary from "./ProjectSummary";
import QuarterParticipation from "./QuarterParticipation";
import SignInMethodsSection from "./SignInMethodsSection";
import WithdrawalSection from "./WithdrawalSection";
import styles from "./profile.module.css";

export const metadata: Metadata = {
  title: "Profile — CTRL+AI",
};

// 게시된 앱 목록은 아직 목업입니다(Phase 5).
const myApps = MOCK_APPS.filter((app) => app.creator.username === "yurikim");

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        titleAddon={<span className="badge badge-mock">준비 중</span>}
        subtitle="내 계정과 참여 분기, 지금까지 만든 결과물입니다."
      />

      <Identity />

      <QuarterParticipation />

      <div className={styles.columns}>
        <AccountSettings />

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
        <ProjectSummary />

        <section className="card">
          <h2 className="section-title">내가 만든 앱 {myApps.length}개</h2>
          {myApps.length > 0 ? (
            <ul className={styles.list}>
              {myApps.map((app) => (
                <li className={styles.listItem} key={app.slug}>
                  <Link className={styles.listLink} href={`/ctrlaistore/${app.slug}`}>
                    {app.name}
                  </Link>
                  <span className="badge badge-ok">게시됨</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={LayoutGrid}
              title="아직 게시한 앱이 없어요"
              text="Project Builder에서 만든 앱을 게시하면 여기에 모여요."
              action={{ label: "앱 만들러 가기", href: "/builder" }}
            />
          )}
        </section>

      </div>

      <WithdrawalSection />
    </>
  );
}
