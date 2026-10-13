"use client";

/**
 * 로그인 화면.
 *
 * **Google이 기본입니다**(google-login, 2026-10-13). Google 로그인이 켜진
 * 곳에서는 "Google로 계속하기"만 보이고, 아이디·비밀번호 칸은 관리자의
 * 비상 로그인용으로 따로 둔 주소(`/login/password`)에만 있습니다. Google
 * 로그인이 아직 꺼진 곳(설정 전의 서버)에서는 지금처럼 비밀번호 칸을
 * 보여 줍니다 — 그렇지 않으면 아무도 들어올 수 없습니다.
 *
 * 비밀번호는 상태에 잠깐 머물렀다가 요청과 함께 떠나고, 어디에도 저장하지
 * 않습니다. 성공하면 백엔드가 HttpOnly 쿠키를 내려 주므로 이 화면이 토큰을
 * 들고 있을 일이 없습니다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";

import BrandMark from "@/app/components/BrandMark";
import { useEffect, useId, useState } from "react";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import GoogleButton from "@/app/components/GoogleButton";
import { useSite, useSiteLoaded } from "@/app/components/SiteProvider";
import { describeError } from "@/lib/http";
import { GOOGLE_START_URL, googleResultMessage, login } from "@/lib/auth";

import styles from "./auth.module.css";

export default function LoginForm({ mode = "auto" }: { mode?: "auto" | "password" }) {
  const site = useSite();
  const loaded = useSiteLoaded();
  const [googleNote, setGoogleNote] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const router = useRouter();
  const { refresh } = useCurrentUser();
  const usernameId = useId();
  const passwordId = useId();

  // Google에서 돌아온 결과(?google=cancelled 등). useSearchParams를 쓰면 이
  // 정적 화면 전체가 Suspense를 요구하므로 주소를 직접 읽습니다.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("google");
    const message = googleResultMessage(result);
    if (message) queueMicrotask(() => setGoogleNote(message));
  }, []);

  const googleFirst = mode === "auto" && site.google_login;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      await refresh();
      router.replace("/");
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.screen} ${styles.screenLogin}`}>
      <div className={`${styles.card} ${styles.cardLogin}`}>
        <span className={styles.brand}>
          <BrandMark size={18} variant="glyph" />
          CTRL+AI
        </span>

        <div>
          <h1 className={styles.title}>{mode === "password" ? "관리자 로그인" : "로그인"}</h1>
          <p className={styles.subtitle}>
            {mode === "password"
              ? "관리자 비상 로그인입니다. 회원은 Google로 로그인해 주세요."
              : googleFirst
                ? "Google 계정으로 로그인해요. 처음이면 다음 화면에서 아이디를 정해요."
                : "아이디와 비밀번호를 입력해 주세요."}
          </p>
        </div>

        {googleNote && (
          <p className={styles.notice} role="status">
            {googleNote}
          </p>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {!loaded && mode === "auto" ? (
          <p className="small muted">불러오는 중…</p>
        ) : googleFirst ? (
          <GoogleButton href={GOOGLE_START_URL} />
        ) : (
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
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={passwordId}>
              비밀번호
            </label>
            <input
              className="field"
              id={passwordId}
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </form>
        )}

        <p className={styles.footer}>
          <span>처음 오셨나요?</span>
          <Link className={styles.footerLink} href="/signup">
            회원가입
          </Link>
        </p>
      </div>
    </div>
  );
}
