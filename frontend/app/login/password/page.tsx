import type { Metadata } from "next";

import LoginForm from "../LoginForm";

export const metadata: Metadata = {
  title: "관리자 로그인 — CTRL+AI",
  // 메뉴 어디에도 걸지 않는 주소입니다. 검색에도 남기지 않습니다.
  robots: { index: false, follow: false },
};

/**
 * 관리자 비상 로그인(google-login).
 *
 * 회원은 Google로 들어옵니다. 아이디·비밀번호는 Google 연결이 막혔을 때
 * 관리자가 쓰는 길로만 남고, 어떤 화면에서도 이 주소로 연결하지 않습니다.
 */
export default function PasswordLoginPage() {
  return <LoginForm mode="password" />;
}
