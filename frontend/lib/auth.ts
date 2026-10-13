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
  /** Google로 만든 계정은 비밀번호가 없습니다 — 탈퇴 확인은 아이디로 합니다. */
  has_password: boolean;
}

export interface SignupInput {
  username: string;
  email: string;
  password: string;
  display_name: string;
  /** 초대 코드. 대소문자와 앞뒤 공백은 백엔드가 정리합니다. */
  invite_code: string;
  /** 개인정보 처리방침·이용약관 동의 — 백엔드가 다시 확인합니다. */
  terms_accepted: boolean;
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

// ------------------------------------------------------------ Google (google-login)

/** "Google로 계속하기" — 백엔드가 Google로 보냅니다. 토큰은 브라우저에 오지 않습니다. */
export const GOOGLE_START_URL = "/api/auth/google/start";
/** Profile에서 지금 계정에 Google을 연결합니다. */
export const GOOGLE_LINK_URL = "/api/account/google/link/start";

/** 처음 Google로 들어온 사람의 설정 화면이 받는 정보. */
export interface GooglePending {
  email: string;
  /** Google에서 이메일 확인이 끝났는지. 아니면 가입할 수 없습니다. */
  email_verified: boolean;
  name: string;
  suggested_username: string;
  needs_invite_code: boolean;
  /** 이 이메일로 이미 가입한 계정이 있음 — 그 계정으로 로그인해 연결해야 합니다. */
  email_taken: boolean;
}

export function fetchGooglePending(): Promise<GooglePending> {
  return request<GooglePending>("/auth/google/pending");
}

export function completeGoogleSignup(input: {
  username: string;
  display_name: string;
  invite_code: string;
  /** 개인정보 처리방침·이용약관 동의 — 백엔드가 다시 확인합니다. */
  terms_accepted: boolean;
}): Promise<CurrentUser> {
  return request<CurrentUser>("/auth/google/complete", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface GoogleConnection {
  available: boolean;
  linked: boolean;
  email: string;
}

export function fetchGoogleConnection(): Promise<GoogleConnection> {
  return request<GoogleConnection>("/account/google");
}

// ------------------------------------------------------------ 로그인 방법 (member-password-login)

/** Profile › 로그인 방법. 둘 중 하나는 늘 남아 있어야 합니다(백엔드가 지킵니다). */
export interface SignInMethods {
  password: boolean;
  google: GoogleConnection;
}

export function fetchSignInMethods(): Promise<SignInMethods> {
  return request<SignInMethods>("/account/sign-in");
}

/** 비밀번호 만들기(처음) 또는 바꾸기(지금 비밀번호 필요). 다른 브라우저는 로그아웃됩니다. */
export function setPassword(newPassword: string, currentPassword = ""): Promise<SignInMethods> {
  return request<SignInMethods>("/account/password", {
    method: "PUT",
    body: JSON.stringify({ new_password: newPassword, current_password: currentPassword }),
  });
}

/** 비밀번호 로그인 없애기 — Google이 연결되어 있을 때만. */
export function removePassword(currentPassword: string): Promise<SignInMethods> {
  return request<SignInMethods>("/account/password/remove", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword }),
  });
}

/** Google 연결 끊기 — 비밀번호가 있을 때만, 그 비밀번호로 확인합니다. */
export function unlinkGoogle(currentPassword: string): Promise<SignInMethods> {
  return request<SignInMethods>("/account/google/unlink", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword }),
  });
}

/** 로그인·연결 뒤 주소의 `?google=` 값이 뜻하는 것. */
export const GOOGLE_RESULT_MESSAGE: Record<string, string> = {
  cancelled: "Google 로그인을 취소했어요.",
  expired: "시간이 지나 다시 시작해야 해요. 한 번 더 눌러 주세요.",
  failed: "Google에서 정보를 받지 못했어요. 잠시 후 다시 시도해 주세요.",
  blocked: "사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.",
  linked: "Google 계정을 연결했어요. 다음부터 Google로 로그인할 수 있어요.",
  taken: "이 Google 계정은 이미 다른 CTRL+AI 계정에 연결되어 있어요.",
  already: "이미 이 계정에 연결된 Google 계정이에요.",
  other: "이 계정에는 이미 다른 Google 계정이 연결되어 있어요.",
  reauth: "보안을 위해 로그아웃한 뒤 다시 로그인하고 연결해 주세요. 로그인한 지 10분이 지났어요.",
};

/** `?google=` 값에 맞는 문장. 모르는 값(또는 `constructor` 같은 이름)은 null. */
export function googleResultMessage(result: string | null): string | null {
  if (!result || !Object.hasOwn(GOOGLE_RESULT_MESSAGE, result)) return null;
  return GOOGLE_RESULT_MESSAGE[result];
}

/** 초대 링크(/signup?code=…)로 왔다면 Google 설정 화면까지 코드를 들고 갑니다. */
export const INVITE_CODE_STORAGE_KEY = "ctrlai.invite-code";
