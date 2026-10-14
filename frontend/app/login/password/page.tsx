import { redirect } from "next/navigation";

/**
 * 예전 관리자 비상 로그인 주소.
 *
 * member-password-login(2026-10-14)부터 아이디·비밀번호 칸은 `/login`에
 * Google 단추와 함께 있습니다. 이 주소로 저장해 둔 사람을 위해 남겨 두고
 * `/login`으로 보냅니다.
 */
export default function PasswordLoginPage() {
  redirect("/login");
}
