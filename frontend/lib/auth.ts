/**
 * 로그인 관련 백엔드 호출.
 *
 * 세션 토큰은 이 파일 어디에도 저장하지 않습니다. 백엔드가 HttpOnly
 * 쿠키로 내려주고 브라우저가 알아서 보냅니다. 자바스크립트가 토큰을
 * 만질 수 없다는 것이 핵심입니다 — localStorage에 두면 페이지의 어떤
 * 스크립트든 읽어갈 수 있습니다.
 */

import { request } from "./http";

/** 회원 상태. 백엔드의 AccountStatus와 짝을 이룹니다. */
export type AccountStatus = "active" | "inactive" | "former";

export type UserRole = "admin" | "member";

/** `GET /api/auth/me` 응답. 비밀번호 해시는 어떤 응답에도 없습니다. */
export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  display_name: string;
  role: UserRole;
  account_status: AccountStatus;
  /** 관리 메뉴를 보여 줄지 결정합니다. 권한 자체는 백엔드가 다시 확인합니다. */
  is_admin: boolean;
}

export interface SignupInput {
  username: string;
  email: string;
  password: string;
  display_name: string;
}

export const MIN_PASSWORD_LENGTH = 8;

/** 아이디 규칙. 백엔드의 USERNAME_PATTERN과 같습니다. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export function register(input: SignupInput): Promise<CurrentUser> {
  return request<CurrentUser>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(username: string, password: string): Promise<CurrentUser> {
  return request<CurrentUser>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>("/auth/me");
}
