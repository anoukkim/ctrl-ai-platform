"use client";

/**
 * 연결한 서비스 (GitHub · YouTube) — shown only once GitHub (Phase 4) is
 * switched on. Until then the card held two buttons nobody could press,
 * with "Phase 4/7에서 제공됩니다" as their tooltips (2026-10-19 audit); the
 * Builder hides GitHub the same way.
 */

import { useSite } from "@/app/components/SiteProvider";

import styles from "./profile.module.css";

export default function ServiceConnections() {
  const { github_enabled: githubEnabled } = useSite();
  if (!githubEnabled) return null;
  return (
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
          <span className="badge badge-muted">준비 중</span>
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
          <span className="badge badge-muted">준비 중</span>
        </span>
      </div>
      <p className="small dim" style={{ marginTop: "0.6rem" }}>
        CTRL+AI는 GitHub나 Google의 비밀번호·토큰을 붙여 넣어 달라고 하지 않습니다.
      </p>
    </section>
  );
}
