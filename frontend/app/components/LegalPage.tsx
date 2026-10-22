/**
 * 개인정보 처리방침·이용약관이 함께 쓰는 문서 틀 (privacy-and-terms).
 *
 * 로그인 전에도 읽는 화면이라 사이드바 없이 혼자 섭니다. 문장이 길어서
 * 읽기 폭을 좁게 잡고, 글꼴과 색은 사이트 토큰을 그대로 씁니다.
 * Server Component입니다 — 내용이 전부 정적인 글이라 자바스크립트가
 * 필요 없습니다.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import BrandMark from "@/app/components/BrandMark";
import BackButton from "@/app/components/BackButton";

import styles from "./legal.module.css";

export default function LegalPage({
  title,
  effective,
  children,
}: {
  title: string;
  /** "시행일 2026-10-14 · v1" 같은 한 줄. */
  effective: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.screen}>
      <article className={styles.doc}>
        <header className={styles.head}>
          <BackButton className={styles.back} />
          <Link className={styles.brand} href="/">
            <BrandMark size={18} variant="glyph" />
            CTRL+AI
          </Link>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.effective}>{effective}</p>
        </header>

        {children}

        <footer className={styles.foot}>
          <Link className={styles.footLink} href="/privacy">
            개인정보 처리방침
          </Link>
          <span aria-hidden="true">·</span>
          <Link className={styles.footLink} href="/terms">
            이용약관
          </Link>
          <span aria-hidden="true">·</span>
          <Link className={styles.footLink} href="/login">
            로그인으로
          </Link>
        </footer>
      </article>
    </div>
  );
}
