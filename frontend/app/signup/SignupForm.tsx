"use client";

/**
 * 회원가입 폼.
 *
 * 규칙은 입력하기 전에 미리 알려 줍니다. 보내고 나서 거절당하는 것보다
 * 낫기 때문입니다. 같은 규칙을 백엔드도 다시 확인합니다 — 브라우저 검사는
 * 친절일 뿐 보안이 아닙니다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import { describeError } from "@/lib/http";
import { MIN_PASSWORD_LENGTH, USERNAME_PATTERN, register } from "@/lib/auth";

import styles from "@/app/login/auth.module.css";

export default function SignupForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const router = useRouter();
  const { refresh } = useCurrentUser();
  const usernameId = useId();
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();

  const trimmedUsername = username.trim();
  const usernameValid = trimmedUsername.length >= 3 && USERNAME_PATTERN.test(trimmedUsername);
  const passwordValid = password.length >= MIN_PASSWORD_LENGTH;
  const canSubmit =
    usernameValid && passwordValid && email.trim().length > 0 && displayName.trim().length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      await register({
        username: trimmedUsername,
        email: email.trim(),
        password,
        display_name: displayName.trim(),
      });
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
          <span className={styles.brandGlyph} aria-hidden="true">
            AI
          </span>
          Ctrl AI
        </span>

        <div>
          <h1 className={styles.title}>회원가입</h1>
          <p className={styles.subtitle}>
            Ctrl AI에서 앱과 영상을 만들어 보세요. 몇 가지만 입력하면 됩니다.
          </p>
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
            <span className={styles.hint}>
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

          <div className={styles.field}>
            <label className={styles.label} htmlFor={emailId}>
              이메일
            </label>
            <input
              className="field"
              id={emailId}
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
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
              autoComplete="new-password"
              required
            />
            <span className={styles.hint}>{MIN_PASSWORD_LENGTH}자 이상 입력해 주세요.</span>
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy || !canSubmit}>
            {busy ? "가입 중…" : "가입하고 시작하기"}
          </button>
        </form>

        <p className={styles.footer}>
          <span>이미 계정이 있으신가요?</span>
          <Link className={styles.footerLink} href="/login">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
