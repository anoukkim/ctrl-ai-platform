"use client";

/**
 * "로그인 방법을 하나 더 만들어 주세요" — 두 방법이 다 있을 때까지 모든
 * 화면 맨 위에 붙는 한 줄(signup-google-first, 2026-11-03).
 *
 * 새 회원은 가입할 때 Google과 비밀번호를 함께 만들지만, 그 전에 가입한
 * 회원(관리자 포함)은 하나만 있을 수 있습니다. 막지는 않습니다 — 안내일
 * 뿐이고, 로그인 방법을 없애는 규칙은 그대로입니다(하나만 남으면 못 없앰).
 *
 * 베타 배너와 같은 띠입니다. 둘 다 보일 때는 `--banner-h`가 두 줄만큼
 * 커지도록 `<html data-signin-notice>`를 붙입니다(globals.css) — 화면
 * 높이를 꽉 채우는 Chat과 작업 공간이 그 값을 빼기 때문입니다.
 */

import Link from "next/link";
import { useEffect } from "react";

import { hasBothSignInMethods } from "@/lib/auth";

import { useCurrentUser } from "./CurrentUserProvider";
import { useSite } from "./SiteProvider";

import styles from "./beta-banner.module.css";

export default function SignInMethodBanner() {
  const { state } = useCurrentUser();
  const site = useSite();
  const user = state.phase === "authenticated" ? state.user : null;
  // Google이 꺼진 서버에서 비밀번호만 있는 회원은 연결할 길이 없으니 조용히 둡니다.
  const shown =
    user !== null &&
    !hasBothSignInMethods(user) &&
    (user.has_password === false || site.google_login);

  useEffect(() => {
    const root = document.documentElement;
    if (shown) root.dataset.signinNotice = "";
    else delete root.dataset.signinNotice;
    return () => {
      delete root.dataset.signinNotice;
    };
  }, [shown]);

  if (!shown) return null;

  return (
    <div className={styles.banner} role="region" aria-label="로그인 방법 안내">
      <span className={styles.text}>
        로그인 방법을 하나 더 만들어 주세요. 앞으로는 Google 계정과 아이디·비밀번호가 둘 다
        필요해요.
      </span>
      <Link className={styles.feedback} href="/profile#sign-in-methods">
        {user.has_password ? "Google 연결하기" : "비밀번호 만들기"}
      </Link>
    </div>
  );
}
