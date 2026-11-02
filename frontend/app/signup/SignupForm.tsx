"use client";

/**
 * 회원가입 — Google로만 (signup-google-first, 2026-11-03).
 *
 * 운영진의 결정: 회원은 모두 Google 계정이 있으니 가입은 Google로만 받고,
 * 아이디와 비밀번호는 Google에서 돌아온 뒤의 설정 화면에서 함께 만듭니다.
 * 그래서 새 회원은 첫날부터 두 방법으로 로그인할 수 있습니다.
 *
 * 초대 코드는 여전히 필요합니다. CTRL+AI는 동아리 회원만 쓰는 곳이라,
 * 주소가 알려져도 코드 없이는 계정이 만들어지지 않습니다. 링크로 받은
 * 코드는 설정 화면까지 들고 갑니다(sessionStorage).
 *
 * Google 로그인이 꺼진 서버(설정 전)에서는 가입할 길이 없다고 말합니다 —
 * 아이디·비밀번호 가입은 이제 없습니다.
 */

import Link from "next/link";

import BrandMark from "@/app/components/BrandMark";
import { useEffect } from "react";

import GoogleButton from "@/app/components/GoogleButton";
import { useSite, useSiteLoaded } from "@/app/components/SiteProvider";
import { GOOGLE_START_URL, INVITE_CODE_STORAGE_KEY } from "@/lib/auth";

import styles from "@/app/login/auth.module.css";

import DataLocationNotice from "./DataLocationNotice";
import Skeleton from "@/app/components/Skeleton";

export default function SignupForm({ initialCode = "" }: { initialCode?: string }) {
  const site = useSite();
  const loaded = useSiteLoaded();

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
            CTRL+AI는 동아리 회원을 위한 곳입니다. Google 계정으로 가입하고, 동아리에서 받은
            초대 코드를 적어 주세요.
          </p>
        </div>

        {!loaded ? (
          <Skeleton />
        ) : site.google_login ? (
          <div className={styles.form}>
            <GoogleButton href={GOOGLE_START_URL} />
            <p className={styles.hint}>
              Google에서 돌아오면 아이디, 이름, 비밀번호를 정하고 초대 코드를 적어요.
              {initialCode ? " 받은 초대 코드는 그 화면에 미리 채워 둘게요." : ""}
            </p>
            <p className={styles.hint}>
              비밀번호도 함께 만들어요. 그래야 Google과 아이디·비밀번호 둘 다로 로그인할 수
              있어요.
            </p>
          </div>
        ) : (
          <p className={styles.error} role="alert">
            이 서버에서는 아직 Google 로그인이 켜지지 않아 가입할 수 없어요. 운영진에게 말씀해
            주세요.
          </p>
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
