/**
 * Profile — 계정과 시즌, 연결한 서비스 (목업).
 *
 * 시즌 카드는 네 가지를 한눈에 보여 주는 것이 목적입니다.
 *   1. 지금 어느 시즌인지
 *   2. 활동 회원인지
 *   3. 언제까지 쓸 수 있는지
 *   4. 지난 작업물이 그대로 남는지
 *
 * 날짜 계산은 lib/mock-data.ts의 QUARTER_RANGE 하나만 보고 합니다. 실제
 * 시즌 기능이 생기면 그 값만 바꾸면 됩니다.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { MOCK_APPS } from "@/lib/mock-data";

import { AccountSettings, Identity } from "./AccountIdentity";
import ProjectSummary from "./ProjectSummary";
import QuarterParticipation from "./QuarterParticipation";
import styles from "./profile.module.css";

export const metadata: Metadata = {
  title: "Profile — CTRL+AI",
};

// 게시된 앱 목록은 아직 목업입니다(Phase 5).
const myApps = MOCK_APPS.filter((app) => app.creator.username === "yurikim");

export default function ProfilePage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          Profile <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">내 계정과 참여 분기, 지금까지 만든 결과물입니다.</p>
      </header>

      <Identity />

      <QuarterParticipation />

      <div className={styles.columns}>
        <AccountSettings />

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
              <p className={styles.connectionHint}>만든 영상을 내 채널에 올립니다.</p>
            </div>
            <span className={styles.connectionRight}>
              <span className="badge badge-muted">연결 안 됨</span>
              <button className="btn btn-sm" type="button" disabled title="Phase 7에서 제공됩니다">
                연결하기
              </button>
            </span>
          </div>
          <p className="small dim" style={{ marginTop: "0.6rem" }}>
            CTRL+AI는 개인 접근 토큰을 붙여넣어 달라고 요청하지 않습니다.
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
            <p className="small dim">아직 게시한 앱이 없습니다.</p>
          )}
        </section>

      </div>
    </>
  );
}
