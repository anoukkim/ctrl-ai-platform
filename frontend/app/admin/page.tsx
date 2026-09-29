/**
 * Admin — 관리 화면 (목업).
 *
 * 회원 자격과 크레딧이 시즌 단위로 운영되므로, 시즌 참여 등록과 제공자별
 * 크레딧 할당을 담당할 사람이 필요합니다. 아직 어떤 버튼도 동작하지 않습니다.
 *
 * 맨 아래의 서버 상태 카드만 실제로 동작합니다. 진짜 `GET /api/health`를
 * 호출합니다.
 */

import type { Metadata } from "next";

import BackendStatus from "@/app/components/BackendStatus";
import {
  CURRENT_SEASON,
  MEMBERSHIP_LABEL,
  MOCK_MEMBERS,
  MOCK_SEASONS,
  ROLE_LABEL,
  SEASON_STATUS_LABEL,
  formatNumber,
  type MembershipStatus,
} from "@/lib/mock-data";

import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Admin — Ctrl AI",
};

const MEMBERSHIP_BADGE: Record<MembershipStatus, string> = {
  active: "badge-ok",
  inactive: "badge-warn",
  former: "badge-muted",
};

const SEASON_BADGE: Record<string, string> = {
  active: "badge-ok",
  upcoming: "badge-accent",
  closed: "badge-muted",
};

export default function AdminPage() {
  const activeCount = MOCK_MEMBERS.filter((m) => m.membership === "active").length;
  const inactiveCount = MOCK_MEMBERS.filter((m) => m.membership === "inactive").length;
  const formerCount = MOCK_MEMBERS.filter((m) => m.membership === "former").length;

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          Admin <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          회원 관리, 시즌 관리, 제공자별 크레딧 관리를 담당합니다. 제공자 이용 권한은 Ctrl AI가
          갖고 회원별 사용량을 기록하므로, 회원이 직접 API 키를 보관하지 않습니다.
        </p>
      </header>

      <p className="notice">
        <strong>아직 동작하지 않는 화면입니다.</strong> 회원 관리, 시즌 참여 등록, 크레딧
        관리는 Phase 1에서 만듭니다.
      </p>

      <div className={styles.stats}>
        <div className={`${styles.stat} ${styles.statAccent}`}>
          <span className={styles.statValue}>{MOCK_MEMBERS.length}</span>
          <span className={styles.statLabel}>전체 계정</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{activeCount}</span>
          <span className={styles.statLabel}>활동 회원</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{inactiveCount}</span>
          <span className={styles.statLabel}>비활동 회원</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formerCount}</span>
          <span className={styles.statLabel}>탈퇴 회원</span>
        </div>
      </div>

      <div className={styles.sections}>
        <section>
          <h2 className="section-title">회원 관리</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">회원</th>
                  <th scope="col">역할</th>
                  <th scope="col">시즌</th>
                  <th scope="col">상태</th>
                  <th scope="col">Claude 할당량</th>
                  <th scope="col">영상 생성 크레딧</th>
                  <th scope="col">관리</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_MEMBERS.map((member) => (
                  <tr key={member.username}>
                    <td>
                      <span className={styles.memberName}>
                        {member.displayName}
                        <span className={styles.memberHandle}>@{member.username}</span>
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-muted">{ROLE_LABEL[member.role]}</span>
                    </td>
                    <td>{member.season}</td>
                    <td>
                      <span className={`badge ${MEMBERSHIP_BADGE[member.membership]}`}>
                        {MEMBERSHIP_LABEL[member.membership]}
                      </span>
                    </td>
                    <td className="numeric">{formatNumber(member.claudeTokens)} 토큰</td>
                    <td className="numeric">{formatNumber(member.videoCredits)} 크레딧</td>
                    <td>
                      <span className={styles.rowActions}>
                        <button className="btn btn-sm" type="button" disabled>
                          회원 활성화
                        </button>
                        <button className="btn btn-sm" type="button" disabled>
                          시즌 참여 등록
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="section-title">시즌 관리</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">시즌</th>
                  <th scope="col">시작</th>
                  <th scope="col">종료</th>
                  <th scope="col">상태</th>
                  <th scope="col">참여 인원</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_SEASONS.map((season) => (
                  <tr key={season.name}>
                    <td>{season.name}</td>
                    <td>{season.startsAt}</td>
                    <td>{season.endsAt}</td>
                    <td>
                      <span className={`badge ${SEASON_BADGE[season.status] ?? "badge-muted"}`}>
                        {SEASON_STATUS_LABEL[season.status]}
                      </span>
                    </td>
                    <td className="numeric">{season.members}명</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">크레딧 관리</h2>
          <p className="small muted" style={{ marginBottom: "1rem" }}>
            제공자마다 단위가 다르므로 따로 지정합니다. {CURRENT_SEASON} 기준으로 회원 한 명을
            열면 이런 화면이 됩니다.
          </p>
          <div className={styles.allocationPanel}>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor="alloc-member">
                회원
              </label>
              <input className="field" id="alloc-member" defaultValue="박민지" disabled />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor="alloc-claude">
                Claude 할당량 (토큰)
              </label>
              <input
                className="field"
                id="alloc-claude"
                defaultValue="2,000,000"
                disabled
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor="alloc-video">
                영상 생성 크레딧
              </label>
              <input className="field" id="alloc-video" defaultValue="100" disabled />
            </div>
            <button className="btn btn-primary" type="button" disabled>
              저장
            </button>
          </div>
        </section>

        <section>
          <h2 className="section-title">콘텐츠 관리</h2>
          <div className="card">
            <p className="small muted">
              게시된 앱과 영상을 숨기거나 댓글을 정리하는 기능은 이후 단계에서 추가합니다.
              탈퇴 회원의 작품이라도 만든 사람의 이름은 계속 표시됩니다.
            </p>
          </div>
        </section>

        <section>
          <h2 className="section-title">시스템</h2>
          <BackendStatus />
        </section>
      </div>
    </>
  );
}
