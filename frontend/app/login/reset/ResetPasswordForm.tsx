"use client";

/**
 * 비밀번호를 잊었어요 — 새 비밀번호 만들기(signup-google-first, 2026-11-03).
 *
 * 로그인 화면에서 "비밀번호를 잊었어요"를 누르면 Google로 갔다가 이리로
 * 돌아옵니다. 백엔드는 그 Google 계정과 연결된 회원에게 10분짜리 한 번용
 * 허가(행)를 만들고 쿠키로 기억합니다. 여기서 새 비밀번호를 두 번 적으면
 * 저장되고 바로 로그인됩니다. 다른 브라우저는 로그아웃됩니다 — 예전
 * 비밀번호를 알던 사람이 남아 있으면 안 되니까요.
 *
 * 시간이 지났거나 이미 썼으면 백엔드가 거절하고, 로그인 화면에서 다시
 * 시작하라고 안내합니다. 브라우저가 보는 것은 아이디와 남은 시간뿐입니다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import BrandMark from "@/app/components/BrandMark";
import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import Skeleton from "@/app/components/Skeleton";
import { describeError } from "@/lib/http";
import {
  MIN_PASSWORD_LENGTH,
  completePasswordReset,
  fetchResetPending,
  type ResetPending,
} from "@/lib/auth";

import styles from "@/app/login/auth.module.css";

type State =
  | { phase: "loading" }
  | { phase: "missing"; message: string }
  | { phase: "ready"; pending: ResetPending };

export default function ResetPasswordForm() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const router = useRouter();
  const { refresh } = useCurrentUser();
  const passwordId = useId();
  const confirmId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchResetPending()
      .then((pending) => {
        if (!cancelled) setState({ phase: "ready", pending });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setState({ phase: "missing", message: describeError(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const longEnough = password.length >= MIN_PASSWORD_LENGTH;
  const match = password === confirm;
  const canSubmit = state.phase === "ready" && longEnough && match && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await completePasswordReset(password, confirm);
      await refresh();
      router.replace("/");
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  const minutesLeft =
    state.phase === "ready" ? Math.max(1, Math.ceil(state.pending.seconds_left / 60)) : 0;

  return (
    <div className={`${styles.screen} ${styles.screenLogin}`}>
      <div className={`${styles.card} ${styles.cardLogin}`}>
        <span className={styles.brand}>
          <BrandMark size={18} variant="glyph" />
          CTRL+AI
        </span>

        <div>
          <h1 className={styles.title}>새 비밀번호</h1>
          <p className={styles.subtitle}>Google로 확인했어요. 새 비밀번호를 만들어 주세요.</p>
        </div>

        {state.phase === "loading" && <Skeleton />}

        {state.phase === "missing" && (
          <>
            <p className={styles.error} role="alert">
              {state.message}
            </p>
            <Link className="btn btn-primary" href="/login">
              로그인 화면으로
            </Link>
          </>
        )}

        {state.phase === "ready" && (
          <>
            <p className={styles.notice} role="status">
              <strong>{state.pending.username}</strong> 계정의 비밀번호를 바꿔요. {minutesLeft}분 안에
              저장해 주세요.
            </p>

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <form className={styles.form} onSubmit={submit}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={passwordId}>
                  새 비밀번호
                </label>
                <input
                  className="field"
                  id={passwordId}
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  maxLength={128}
                  autoFocus
                  required
                />
                <span
                  className={`${styles.hint} ${password ? (longEnough ? styles.hintOk : styles.hintError) : ""}`}
                >
                  {MIN_PASSWORD_LENGTH}자 이상. 다른 곳에서 쓰지 않는 비밀번호가 좋아요.
                </span>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={confirmId}>
                  새 비밀번호 확인
                </label>
                <input
                  className="field"
                  id={confirmId}
                  name="password_confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  maxLength={128}
                  required
                />
                <span className={`${styles.hint} ${confirm ? (match ? styles.hintOk : styles.hintError) : ""}`}>
                  {confirm && !match ? "두 칸의 비밀번호가 달라요." : "같은 비밀번호를 한 번 더 적어 주세요."}
                </span>
              </div>

              <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
                {busy ? "저장 중…" : "저장하고 로그인"}
              </button>
            </form>
            <p className={styles.hint}>저장하면 다른 브라우저는 로그아웃돼요.</p>
          </>
        )}

        <p className={styles.footer}>
          <Link className={styles.footerLink} href="/login">
            로그인 화면으로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  );
}
