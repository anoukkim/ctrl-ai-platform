"use client";

/**
 * Profile 위쪽의 신원 영역과 계정 설정 카드.
 *
 * 목업이 아니라 로그인한 실제 회원을 보여 줍니다. Client Component인 이유는
 * 회원 정보를 CurrentUserProvider에서 가져오기 때문입니다.
 *
 * 계정 상태(사용 가능/사용 중지/탈퇴)는 Phase 1a가 넣은 account_status를
 * 그대로 씁니다. 이번 분기 참여(참여 중 · 승인 대기 · 참여 중지 · 미참여)와는 다른 값이에요. 분기 참여에 따른 규칙은 Phase 1b에서 붙습니다.
 */

import { setAurora, useAurora } from "@/lib/aurora";
import { useState } from "react";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import { useSpendFeedback } from "@/app/components/SpendFeedbackProvider";
import { describeError } from "@/lib/http";
import { useMyQuarter } from "@/app/components/MyQuarterProvider";
import { updateDisplayName, type AccountStatus, type UserRole } from "@/lib/auth";
import { STANDING_BADGE, STANDING_LABEL, standingOf } from "@/lib/quarters";

import styles from "./profile.module.css";

/** 계정 — 로그인할 수 있는가. 이번 분기 참여(참여 중 · 미참여)와는 다른 말. */
const STATUS_LABEL: Record<AccountStatus, string> = {
  active: "사용 가능",
  inactive: "사용 중지",
  former: "탈퇴 회원",
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "관리자",
  member: "회원",
};

export function Identity() {
  const { state } = useCurrentUser();
  const { state: quarterState } = useMyQuarter();
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
          {/* 이번 분기 참여 상태. 계정 상태(아래 계정 설정)와는 다른 값입니다. */}
          {quarterState.phase === "ready" && quarterState.quarter.quarter !== null && (
            <span className={`badge ${STANDING_BADGE[standingOf(quarterState.quarter)]}`}>
              {STANDING_LABEL[standingOf(quarterState.quarter)]}
            </span>
          )}
          {quarterState.phase === "ready" && quarterState.quarter.quarter !== null && (
            <span className="badge badge-accent">{quarterState.quarter.quarter.display_name}</span>
          )}
          <span className="badge badge-muted">{ROLE_LABEL[user.role]}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Profile › 알림 (feat-spend-feedback) — 지갑에서 돈이 빠질 때의 알림을
 * 켜고 끕니다. 움직임은 기기의 "움직임 줄이기" 설정을 따릅니다.
 */
export function NotificationSettings() {
  const { enabled, setEnabled, sound, setSound } = useSpendFeedback();
  const aurora = useAurora();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await setEnabled(!enabled);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="profile-notifications" id="notifications">
      {/* owner-polish-3 (c2): the list itself lives only in the sidebar's
          bell now ("오른쪽 알림 필요 없음"); these two switches stay here. */}
      <h2 className="section-title" id="profile-notifications">
        알림 설정
      </h2>
      {/* 두 줄이 같은 모양: 제목과 한 줄 설명은 왼쪽, 스위치는 오른쪽
          (owner, 2026-10-16). 체크박스가 스위치로 보이고, 키보드와 화면
          읽기는 체크박스 그대로입니다. */}
      <div className={styles.switchRows}>
        <div className={styles.switchRow}>
          <label className={styles.switchText} htmlFor="spend-notifications-toggle">
            <strong>사용 알림 표시</strong>
            <span className="small dim">
              지원금에서 돈이 빠질 때 &ldquo;12원을 사용했어요!&rdquo; 알림과 사이드바의 &ldquo;-12원&rdquo;,
              25·50·75% 같은 이정표를 보여 줍니다.
            </span>
          </label>
          <input
            className={styles.switch}
            id="spend-notifications-toggle"
            type="checkbox"
            role="switch"
            aria-checked={enabled}
            checked={enabled}
            disabled={busy}
            onChange={() => void toggle()}
            data-testid="spend-notifications-toggle"
          />
        </div>
        <div className={styles.switchRow}>
          <label className={styles.switchText} htmlFor="spend-sound-toggle">
            <strong>띠링 소리</strong>
            <span className="small dim">
              돈이 빠질 때 짧은 소리를 함께 냅니다. 이 기기에만 적용되고, 기본은 꺼져 있어요.
            </span>
          </label>
          <input
            className={styles.switch}
            id="spend-sound-toggle"
            type="checkbox"
            role="switch"
            aria-checked={sound}
            checked={sound}
            disabled={!enabled}
            onChange={() => setSound(!sound)}
            data-testid="spend-sound-toggle"
          />
        </div>
        <div className={styles.switchRow}>
          <label className={styles.switchText} htmlFor="aurora-toggle">
            <strong>오로라 배경</strong>
            <span className="small dim">
              만드는 중일 때 그림 카드와 미리보기 칸 안에 아주 은은한 빛을 띄워요. 이 기기에만 적용되고, 기본은 켜져
              있어요. 움직임 줄이기를 켠 기기에서는 늘 꺼져요.
            </span>
          </label>
          <input
            className={styles.switch}
            id="aurora-toggle"
            type="checkbox"
            role="switch"
            aria-checked={aurora}
            checked={aurora}
            onChange={() => setAurora(!aurora)}
            data-testid="aurora-toggle"
          />
        </div>
      </div>
      <p className="small dim" style={{ marginTop: "0.6rem" }}>
        움직임 줄이기: 기기에서 &ldquo;동작 줄이기&rdquo;를 켜 두면 숫자가 세어 내려가지 않고
        튀어오르는 동전과 소리 없이 알림만 나옵니다.
      </p>
      {error && (
        <p className="small" role="alert" style={{ color: "var(--error-text)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * 계정 설정 — 아이디는 고정, 이름은 바꿀 수 있습니다 (owner-polish 9).
 * 비밀번호는 아래 "로그인 방법" 카드에서 바꿉니다.
 */
export function AccountSettings() {
  const { state, signOut, refresh } = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (state.phase !== "authenticated") return null;

  const user = state.user;
  const trimmed = draft.trim();
  const draftValid = trimmed.length >= 1 && trimmed.length <= 100;

  function startEdit() {
    setDraft(user.display_name);
    setError(null);
    setSaved(null);
    setEditing(true);
  }

  async function save() {
    if (!draftValid || busy) return;
    if (trimmed === user.display_name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await updateDisplayName(trimmed);
      await refresh();
      setEditing(false);
      setSaved(`이름을 "${updated.display_name}"으로 바꿨어요.`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="section-title">계정 설정</h2>
      <div className={styles.rows}>
        <p className={styles.row}>
          <span className={styles.rowLabel}>아이디</span>
          <span className="mono" title="아이디는 바꿀 수 없어요">
            {user.username}
          </span>
        </p>
        {editing ? (
          <form
            className={styles.row}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className={styles.rowLabel} htmlFor="profile-display-name">
              이름
            </label>
            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
              <input
                id="profile-display-name"
                className="field"
                value={draft}
                maxLength={100}
                autoFocus
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button className="btn btn-sm btn-primary" type="submit" disabled={!draftValid || busy}>
                {busy ? "저장 중…" : "저장"}
              </button>
              <button className="btn btn-sm" type="button" disabled={busy} onClick={() => setEditing(false)}>
                취소
              </button>
            </span>
            {!draftValid && (
              <span className="small dim" style={{ flexBasis: "100%" }}>
                이름은 1~100자로 적어 주세요.
              </span>
            )}
          </form>
        ) : (
          <p className={styles.row}>
            <span className={styles.rowLabel}>이름</span>
            <span style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
              {user.display_name}
              <button className="btn btn-sm" type="button" onClick={startEdit}>
                이름 바꾸기
              </button>
            </span>
          </p>
        )}
        <p className={styles.row}>
          <span className={styles.rowLabel}>이메일</span>
          <span className="mono">{user.email}</span>
        </p>
        <p className={styles.row}>
          <span className={styles.rowLabel}>계정 상태</span>
          <span>{STATUS_LABEL[user.account_status]}</span>
        </p>
        <p className={styles.row}>
          <span className={styles.rowLabel}>역할</span>
          <span>{ROLE_LABEL[user.role]}</span>
        </p>
      </div>
      {saved && (
        <p className="small" role="status" style={{ marginTop: "0.6rem" }}>
          {saved}
        </p>
      )}
      {error && (
        <p className="small" role="alert" style={{ color: "var(--error-text)", marginTop: "0.6rem" }}>
          {error}
        </p>
      )}
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
