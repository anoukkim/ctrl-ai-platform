/**
 * Profile — 계정과 시즌, 연결한 서비스 (목업).
 *
 * 시즌 카드는 네 가지를 한눈에 보여 주는 것이 목적입니다.
 *   1. 지금 어느 시즌인지
 *   2. 활동 회원인지
 *   3. 언제까지 쓸 수 있는지
 *   4. 지난 작업물이 그대로 남는지
 *
 * 날짜 계산은 lib/mock-data.ts의 SEASON_RANGE 하나만 보고 합니다. 실제
 * 시즌 기능이 생기면 그 값만 바꾸면 됩니다.
 */

import type { Metadata } from "next";
import Link from "next/link";

import {
  CURRENT_USER,
  MEMBERSHIP_DESCRIPTION,
  MEMBERSHIP_LABEL,
  MOCK_APPS,
  MOCK_PROJECTS,
  MOCK_VIDEOS,
  PROJECT_STATUS_LABEL,
  ROLE_LABEL,
  SEASON_RANGE,
  formatDate,
  seasonDaysRemaining,
} from "@/lib/mock-data";

import styles from "./profile.module.css";

export const metadata: Metadata = {
  title: "Profile — Ctrl AI",
};

const myApps = MOCK_APPS.filter((app) => app.creator.username === CURRENT_USER.username);
const myVideos = MOCK_VIDEOS.filter((video) => video.creator.username === CURRENT_USER.username);

export default function ProfilePage() {
  // 한국어 이름은 성이 앞에 오므로 첫 글자를 그대로 씁니다.
  const initial = CURRENT_USER.displayName.slice(0, 1);
  const daysLeft = seasonDaysRemaining();

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          Profile <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">내 계정과 참여 시즌, 지금까지 만든 결과물입니다.</p>
      </header>

      <div className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">
          {initial}
        </span>
        <div className={styles.identityText}>
          <span className={styles.displayName}>{CURRENT_USER.displayName}</span>
          <span className={styles.username}>@{CURRENT_USER.username}</span>
          <span className={styles.badges}>
            <span className="badge badge-ok">{MEMBERSHIP_LABEL[CURRENT_USER.membership]}</span>
            <span className="badge badge-accent">{CURRENT_USER.season}</span>
            <span className="badge badge-muted">{ROLE_LABEL[CURRENT_USER.role]}</span>
          </span>
        </div>
      </div>

      {/* 시즌 — 언제까지 쓸 수 있는지 분명히 보여 줍니다. */}
      <section className={styles.season} aria-label="현재 시즌">
        <div className={styles.seasonTop}>
          <span className={styles.seasonName}>{SEASON_RANGE.name}</span>
          <span className="badge badge-ok">{MEMBERSHIP_LABEL[CURRENT_USER.membership]}</span>
          <span style={{ flex: "1 1 auto" }} />
          <Link className="btn btn-sm" href="/usage">
            사용량 보기
          </Link>
        </div>

        <div className={styles.seasonGrid}>
          <div className={styles.seasonCell}>
            <span className={styles.seasonLabel}>현재 시즌</span>
            <span className={styles.seasonValue}>{SEASON_RANGE.name}</span>
          </div>
          <div className={styles.seasonCell}>
            <span className={styles.seasonLabel}>기간</span>
            <span className={styles.seasonValue}>
              {formatDate(SEASON_RANGE.startsAt)} – {formatDate(SEASON_RANGE.endsAt)}
            </span>
          </div>
          <div className={styles.seasonCell}>
            <span className={styles.seasonLabel}>시즌 종료까지</span>
            <span className={styles.seasonDday}>{daysLeft}일 남음</span>
          </div>
        </div>

        <p className={styles.seasonNote}>
          {MEMBERSHIP_DESCRIPTION[CURRENT_USER.membership]} 시즌이 끝나도 지금까지 만든
          프로젝트와 게시한 앱·영상은 사라지지 않습니다.
        </p>

        <div className={styles.seasonHistory}>
          <span className={styles.seasonLabel}>참여 시즌</span>
          {CURRENT_USER.seasonsParticipated.map((season) => (
            <span
              className={`badge ${season === SEASON_RANGE.name ? "badge-accent" : "badge-muted"}`}
              key={season}
            >
              {season}
            </span>
          ))}
        </div>
      </section>

      <div className={styles.columns}>
        <section className="card">
          <h2 className="section-title">계정 설정</h2>
          <div className={styles.rows}>
            <p className={styles.row}>
              <span className={styles.rowLabel}>아이디</span>
              <span className="mono">{CURRENT_USER.username}</span>
            </p>
            <p className={styles.row}>
              <span className={styles.rowLabel}>이름</span>
              <span>{CURRENT_USER.displayName}</span>
            </p>
            <p className={styles.row}>
              <span className={styles.rowLabel}>회원 상태</span>
              <span>{MEMBERSHIP_LABEL[CURRENT_USER.membership]}</span>
            </p>
            <p className={styles.row}>
              <span className={styles.rowLabel}>역할</span>
              <span>{ROLE_LABEL[CURRENT_USER.role]}</span>
            </p>
          </div>
          <p className="small dim" style={{ marginTop: "0.6rem" }}>
            회원 가입과 로그인은 Phase 1에서 제공됩니다.
          </p>
        </section>

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
              <span className="badge badge-muted">{CURRENT_USER.github.label}</span>
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
              <span className="badge badge-muted">{CURRENT_USER.youtube.label}</span>
              <button className="btn btn-sm" type="button" disabled title="Phase 7에서 제공됩니다">
                연결하기
              </button>
            </span>
          </div>
          <p className="small dim" style={{ marginTop: "0.6rem" }}>
            Ctrl AI는 개인 접근 토큰을 붙여넣어 달라고 요청하지 않습니다.
          </p>
        </section>
      </div>

      <div className={styles.lists}>
        <section className="card">
          <h2 className="section-title">내 프로젝트 {MOCK_PROJECTS.length}개</h2>
          <ul className={styles.list}>
            {MOCK_PROJECTS.map((project) => (
              <li className={styles.listItem} key={project.id}>
                {project.name}
                <span className="badge badge-muted">{PROJECT_STATUS_LABEL[project.status]}</span>
              </li>
            ))}
          </ul>
          <p className="small dim" style={{ marginTop: "0.5rem" }}>
            프로젝트는 나만 볼 수 있습니다.
          </p>
        </section>

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

        <section className="card">
          <h2 className="section-title">내가 만든 영상 {myVideos.length}개</h2>
          {myVideos.length > 0 ? (
            <ul className={styles.list}>
              {myVideos.map((video) => (
                <li className={styles.listItem} key={video.id}>
                  <Link className={styles.listLink} href={`/ctrlaitube/${video.id}`}>
                    {video.title}
                  </Link>
                  <span className="badge badge-muted">{video.duration}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small dim">아직 만든 영상이 없습니다.</p>
          )}
        </section>
      </div>
    </>
  );
}
