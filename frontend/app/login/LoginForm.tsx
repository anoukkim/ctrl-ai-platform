"use client";

/**
 * 로그인 폼.
 *
 * 비밀번호는 상태에 잠깐 머물렀다가 요청과 함께 떠나고, 어디에도 저장하지
 * 않습니다. 성공하면 백엔드가 HttpOnly 쿠키를 내려 주므로 이 화면이 토큰을
 * 들고 있을 일이 없습니다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";

import BrandMark from "@/app/components/BrandMark";
import { useId, useState } from "react";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import { describeError } from "@/lib/http";
import { login } from "@/lib/auth";

import styles from "./auth.module.css";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const router = useRouter();
  const { refresh } = useCurrentUser();
  const usernameId = useId();
  const passwordId = useId();

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
    <div className={styles.screen}>
      <div className={styles.card}>
        <span className={styles.brand}>
          <BrandMark size={28} />
          CTRL+AI
        </span>

        <div>
          <h1 className={styles.title}>로그인</h1>
          <p className={styles.subtitle}>아이디와 비밀번호를 입력해 주세요.</p>
        </div>

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
