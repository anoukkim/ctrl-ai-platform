"use client";

/**
 * 회원가입 폼.
 *
 * 초대 코드가 있어야 가입할 수 있습니다. CTRL+AI는 동아리 회원만 쓰는
 * 곳이라, 주소가 알려져도 코드 없이는 계정이 만들어지지 않습니다. 코드는
 * 관리자에게서 받고, 링크로 오면 미리 채워져 있습니다.
 *
 * 규칙은 입력하기 전에 미리 알려 줍니다. 보내고 나서 거절당하는 것보다
 * 낫기 때문입니다. 같은 규칙을 백엔드도 다시 확인합니다 — 브라우저 검사는
 * 친절일 뿐 보안이 아닙니다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";

import BrandMark from "@/app/components/BrandMark";
import { useEffect, useId, useState } from "react";

import { useCurrentUser } from "@/app/components/CurrentUserProvider";
import GoogleButton from "@/app/components/GoogleButton";
import { useSite, useSiteLoaded } from "@/app/components/SiteProvider";
import { describeError } from "@/lib/http";
import {
  GOOGLE_START_URL,
  INVITE_CODE_STORAGE_KEY,
  MIN_PASSWORD_LENGTH,
  USERNAME_PATTERN,
  register,
} from "@/lib/auth";

import styles from "@/app/login/auth.module.css";

import DataLocationNotice from "./DataLocationNotice";
import Skeleton from "@/app/components/Skeleton";

export default function SignupForm({ initialCode = "" }: { initialCode?: string }) {
  const site = useSite();
  const loaded = useSiteLoaded();
  const [inviteCode, setInviteCode] = useState(initialCode);

  // 초대 링크의 코드를 Google 설정 화면까지 들고 갑니다. 코드는 비밀이
  // 아니고(회원에게 나눠 주는 값), 이 탭이 닫히면 사라집니다.
  useEffect(() => {
    if (!initialCode) return;
    try {
      window.sessionStorage.setItem(INVITE_CODE_STORAGE_KEY, initialCode);
    } catch {
      /* 저장소를 막아 둔 브라우저에서는 설정 화면에서 직접 적습니다 */
    }
  }, [initialCode]);
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
  const codeId = useId();

  const trimmedUsername = username.trim();
  const usernameValid = trimmedUsername.length >= 3 && USERNAME_PATTERN.test(trimmedUsername);
  const passwordValid = password.length >= MIN_PASSWORD_LENGTH;
  const canSubmit =
    inviteCode.trim().length > 0 &&
    usernameValid &&
    passwordValid &&
    email.trim().length > 0 &&
    displayName.trim().length > 0;

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
        invite_code: inviteCode.trim(),
      });
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
          <h1 className={styles.title}>회원가입</h1>
          <p className={styles.subtitle}>
            CTRL+AI는 동아리 회원을 위한 곳입니다. 동아리에서 받은 초대 코드로 가입해
            주세요.
          </p>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {!loaded ? (
          <Skeleton />
        ) : site.google_login ? (
          // google-login: 회원은 Google로 가입합니다. 아이디와 초대 코드는
          // Google에서 돌아온 뒤의 설정 화면에서 정합니다.
          <div className={styles.form}>
            <GoogleButton href={GOOGLE_START_URL} />
            <p className={styles.hint}>
              처음이면 Google에서 돌아온 뒤 아이디와 이름을 정하고 초대 코드를 적어요.
              {initialCode ? " 받은 초대 코드는 그 화면에 미리 채워 둘게요." : ""}
            </p>
          </div>
        ) : (
        <form className={styles.form} onSubmit={submit}>
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
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="CTRL-XXXX-XXXX"
              autoFocus={!initialCode}
              required
            />
            <span className={styles.hint}>
              관리자에게 받은 코드입니다. 대소문자는 구분하지 않습니다.
            </span>
          </div>

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
              autoFocus={Boolean(initialCode)}
              required
            />
            {/* 입력을 시작하면 규칙을 지켰는지에 따라 색이 바뀝니다. */}
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
            <span
              className={`${styles.hint} ${
                password ? (passwordValid ? styles.hintOk : styles.hintError) : ""
              }`}
            >
              {MIN_PASSWORD_LENGTH}자 이상 입력해 주세요.
            </span>
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy || !canSubmit}>
            {busy ? "가입 중…" : "가입하고 시작하기"}
          </button>
        </form>
        )}

        <DataLocationNotice />

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
