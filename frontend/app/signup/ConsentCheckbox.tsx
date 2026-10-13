"use client";

/**
 * 가입 동의 체크박스 (privacy-and-terms) — 두 가입 화면이 같이 씁니다.
 *
 * 체크해야 가입 버튼이 켜지지만, 실제 규칙은 백엔드가 지킵니다
 * (`terms_accepted`가 없으면 한국어 400). 링크는 새 탭으로 열어 쓰던
 * 폼이 사라지지 않게 합니다.
 */

import Link from "next/link";

import styles from "@/app/login/auth.module.css";

export default function ConsentCheckbox({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={styles.consent} htmlFor={id}>
      <input
        id={id}
        name="terms_accepted"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        required
      />
      <span>
        <Link href="/privacy" target="_blank" rel="noopener noreferrer">
          개인정보 처리방침
        </Link>
        과{" "}
        <Link href="/terms" target="_blank" rel="noopener noreferrer">
          이용약관
        </Link>
        에 동의합니다.
      </span>
    </label>
  );
}
