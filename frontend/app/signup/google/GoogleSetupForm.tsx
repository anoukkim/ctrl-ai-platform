"use client";

/**
 * 처음 Google로 들어온 사람의 설정 화면(google-login).
 *
 * Google에서 돌아오면 백엔드가 그 Google 계정을 잠시 붙잡아 두고 이리로
 * 보냅니다. 여기서 아이디와 이름을 정하고 초대 코드를 적으면 계정이
 * 만들어지고 바로 로그인됩니다. 이 화면에는 Google의 토큰이 없습니다 —
 * 백엔드가 쿠키로 기억하는 "가입 대기"가 있을 뿐입니다.
 *
 * 같은 이메일로 이미 가입한 계정이 있으면 새로 만들지 않고, 그 계정으로
 * 로그인한 뒤 Profile에서 Google을 연결하라고 안내합니다. 이메일이 같다는
 * 것만으로 남의 계정에 들어가게 하지 않기 위해서입니다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import BrandMark from "@/app/components/BrandMark";
import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import { describeError } from "@/lib/http";
import {
  INVITE_CODE_STORAGE_KEY,
  USERNAME_PATTERN,
  completeGoogleSignup,
  fetchGooglePending,
  type GooglePending,
} from "@/lib/auth";

import styles from "@/app/login/auth.module.css";

import DataLocationNotice from "../DataLocationNotice";
import Skeleton from "@/app/components/Skeleton";

type State =
  | { phase: "loading" }
  | { phase: "missing"; message: string }
  | { phase: "ready"; pending: GooglePending };

export default function GoogleSetupForm() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const router = useRouter();
  const { refresh } = useCurrentUser();
  const usernameId = useId();
  const nameId = useId();
  const codeId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchGooglePending()
      .then((pending) => {
        if (cancelled) return;
        let saved = "";
        try {
          saved = window.sessionStorage.getItem(INVITE_CODE_STORAGE_KEY) ?? "";
        } catch {
          /* 저장소를 막아 둔 브라우저 */
        }
        setUsername(pending.suggested_username);
        setDisplayName(pending.name);
        setInviteCode(saved);
        setState({ phase: "ready", pending });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setState({ phase: "missing", message: describeError(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedUsername = username.trim();
  const usernameValid = trimmedUsername.length >= 3 && USERNAME_PATTERN.test(trimmedUsername);
  const needsCode = state.phase === "ready" && state.pending.needs_invite_code;
  const canSubmit =
    state.phase === "ready" &&
    !state.pending.email_taken &&
    state.pending.email_verified &&
    usernameValid &&
    displayName.trim().length > 0 &&
    (!needsCode || inviteCode.trim().length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await completeGoogleSignup({
        username: trimmedUsername,
        display_name: displayName.trim(),
        invite_code: inviteCode.trim(),
      });
      try {
        window.sessionStorage.removeItem(INVITE_CODE_STORAGE_KEY);
      } catch {
        /* 지우지 못해도 탭을 닫으면 사라집니다 */
      }
      await refresh();
      router.replace("/");
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.screen} ${styles.screenSignup}`}>
      <div className={`${styles.card} ${styles.cardSignup}`}>
        <span className={styles.brand}>
          <BrandMark size={18} variant="glyph" />
          CTRL+AI
        </span>

        <div>
          <h1 className={styles.title}>거의 다 됐어요</h1>
          <p className={styles.subtitle}>CTRL+AI에서 쓸 아이디와 이름을 정해 주세요.</p>
        </div>

        {state.phase === "loading" && <Skeleton />}

        {state.phase === "missing" && (
          <>
            <p className={styles.error} role="alert">
              {state.message}
            </p>
            <Link className="btn" href="/signup">
              처음부터 다시 하기
            </Link>
          </>
        )}

        {state.phase === "ready" && state.pending.email_taken && (
          <>
            <p className={styles.error} role="alert">
              {state.pending.email}(으)로 이미 가입한 계정이 있어요. 그 계정으로 로그인한 뒤
              Profile에서 Google을 연결해 주세요.
            </p>
            <Link className="btn btn-primary" href="/login">
              로그인 화면으로
            </Link>
          </>
        )}

        {state.phase === "ready" && !state.pending.email_taken && !state.pending.email_verified && (
          <>
            <p className={styles.error} role="alert">
              {state.pending.email}은(는) Google에서 아직 이메일 확인이 끝나지 않았어요. Google에서
              확인을 마친 뒤 다시 시도해 주세요.
            </p>
            <Link className="btn" href="/signup">
              처음부터 다시 하기
            </Link>
          </>
        )}

        {state.phase === "ready" && !state.pending.email_taken && state.pending.email_verified && (
          <>
            <p className={styles.notice}>
              Google 계정 <strong>{state.pending.email}</strong>(으)로 가입합니다.
            </p>

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <form className={styles.form} onSubmit={submit}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={usernameId}>
                  아이디
                </label>
                <input
                  className="field"
                  id={usernameId}
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
                <span
                  className={`${styles.hint} ${
                    trimmedUsername ? (usernameValid ? styles.hintOk : styles.hintError) : ""
                  }`}
                >
                  영문, 숫자, 밑줄(_)만 쓸 수 있고 3자 이상이어야 합니다.
                </span>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={nameId}>
                  이름
                </label>
                <input
                  className="field"
                  id={nameId}
                  name="display_name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  required
                />
                <span className={styles.hint}>다른 회원에게 보이는 이름입니다.</span>
              </div>

              {needsCode && (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={codeId}>
                    초대 코드
                  </label>
                  <input
                    className="field numeric"
                    id={codeId}
                    name="invite_code"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    autoComplete="off"
                    required
                  />
                  <span className={styles.hint}>동아리에서 받은 초대 코드를 적어 주세요.</span>
                </div>
              )}

              <button className="btn btn-primary" type="submit" disabled={busy || !canSubmit}>
                {busy ? "가입 중…" : "가입하고 시작하기"}
              </button>
            </form>
          </>
        )}

        <DataLocationNotice />
      </div>
    </div>
  );
}
