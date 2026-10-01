"use client";

/**
 * Profile 위쪽의 신원 영역과 계정 설정 카드.
 *
 * 목업이 아니라 로그인한 실제 회원을 보여 줍니다. Client Component인 이유는
 * 회원 정보를 CurrentUserProvider에서 가져오기 때문입니다.
 *
 * 회원 상태(활동/비활동/탈퇴)는 Phase 1a가 넣은 account_status를 그대로
 * 씁니다. 분기 참여에 따른 규칙은 Phase 1b에서 붙습니다.
 */

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import type { AccountStatus, UserRole } from "@/lib/auth";

import styles from "./profile.module.css";

const STATUS_LABEL: Record<AccountStatus, string> = {
  active: "활동 회원",
  inactive: "비활동 회원",
  former: "탈퇴 회원",
};

const STATUS_BADGE: Record<AccountStatus, string> = {
  active: "badge-ok",
  inactive: "badge-warn",
  former: "badge-muted",
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "관리자",
  member: "회원",
};

export function Identity() {
  const { state } = useCurrentUser();
  if (state.phase !== "authenticated") return null;

  const user = state.user;
  // 한국어 이름은 성이 앞에 오므로 첫 글자를 그대로 씁니다.
  const initial = user.display_name.slice(0, 1);

  return (
    <div className={styles.identity}>
      <span className={styles.avatar} aria-hidden="true">
        {initial}
      </span>
      <div className={styles.identityText}>
        <span className={styles.displayName}>{user.display_name}</span>
        <span className={styles.username}>@{user.username}</span>
        <span className={styles.badges}>
          <span className={`badge ${STATUS_BADGE[user.account_status]}`}>
            {STATUS_LABEL[user.account_status]}
          </span>
          <span className="badge badge-muted">{ROLE_LABEL[user.role]}</span>
        </span>
      </div>
    </div>
  );
}

export function AccountSettings() {
  const { state, signOut } = useCurrentUser();
  if (state.phase !== "authenticated") return null;

  const user = state.user;

  return (
    <section className="card">
      <h2 className="section-title">계정 설정</h2>
      <div className={styles.rows}>
        <p className={styles.row}>
          <span className={styles.rowLabel}>아이디</span>
          <span className="mono">{user.username}</span>
        </p>
        <p className={styles.row}>
          <span className={styles.rowLabel}>이름</span>
          <span>{user.display_name}</span>
        </p>
        <p className={styles.row}>
          <span className={styles.rowLabel}>이메일</span>
          <span className="mono">{user.email}</span>
        </p>
        <p className={styles.row}>
          <span className={styles.rowLabel}>회원 상태</span>
          <span>{STATUS_LABEL[user.account_status]}</span>
        </p>
        <p className={styles.row}>
          <span className={styles.rowLabel}>역할</span>
          <span>{ROLE_LABEL[user.role]}</span>
        </p>
      </div>
      <button
        className="btn btn-sm"
        type="button"
        onClick={() => void signOut()}
        style={{ marginTop: "0.8rem" }}
      >
        로그아웃
      </button>
    </section>
  );
}
