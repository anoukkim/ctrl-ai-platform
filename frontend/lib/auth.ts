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
  /** 비밀번호가 없는 계정(예전 Google 가입자) — 탈퇴 확인은 아이디로 합니다. */
  has_password: boolean;
  /** Google 계정이 연결되어 있는지(signup-google-first). 둘 중 하나가 없으면 안내 띠가 보입니다. */
  has_google?: boolean;
  /** Profile › 알림 › 사용 알림 표시(feat-spend-feedback). 예전 서버면 없습니다. */
  spend_notifications?: boolean;
}

export const MIN_PASSWORD_LENGTH = 8;

/** 아이디 규칙. 백엔드의 USERNAME_PATTERN과 같습니다. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * 로그인 방법이 둘 다 있는지(signup-google-first). 하나라도 없으면 화면
 * 맨 위에 "하나 더 만들어 주세요" 띠가 보입니다. 예전 서버(has_google이
 * 없음)에서는 띠를 보이지 않습니다 — 모르는 것을 경고하지 않습니다.
 */
export function hasBothSignInMethods(user: CurrentUser): boolean {
  if (user.has_google === undefined) return true;
  return user.has_password && user.has_google;
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

/** Profile › 계정 설정 › 이름 바꾸기 (owner-polish 9). 아이디는 바뀌지 않습니다. */
export function updateDisplayName(displayName: string): Promise<CurrentUser> {
  return request<CurrentUser>("/account/profile", {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
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
  /** 비밀번호와 확인(signup-google-first) — 가입하는 날부터 두 방법 모두. */
  password: string;
  password_confirm: string;
}): Promise<CurrentUser> {
  return request<CurrentUser>("/auth/google/complete", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ------------------------------------------------------------ 비밀번호를 잊었어요 (signup-google-first)

/** Google로 본인을 확인하고 돌아오면 10분 동안 새 비밀번호를 만들 수 있습니다. */
export const GOOGLE_RESET_START_URL = "/api/auth/google/reset/start";

export interface ResetPending {
  username: string;
  /** 남은 시간(초). 백엔드가 셉니다. */
  seconds_left: number;
}

export function fetchResetPending(): Promise<ResetPending> {
  return request<ResetPending>("/auth/google/reset/pending");
}

/** 새 비밀번호를 저장하고 바로 로그인합니다. 다른 브라우저는 로그아웃됩니다. */
export function completePasswordReset(password: string, passwordConfirm: string): Promise<CurrentUser> {
  return request<CurrentUser>("/auth/google/reset/complete", {
    method: "POST",
    body: JSON.stringify({ password, password_confirm: passwordConfirm }),
  });
}

export interface GoogleConnection {
  available: boolean;
  linked: boolean;
  email: string;
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
  reset_unknown:
    "이 Google 계정과 연결된 회원이 없어요. 가입할 때 쓴 Google 계정으로 다시 해 보거나, 운영진에게 말씀해 주세요.",
};

/** `?google=` 값에 맞는 문장. 모르는 값(또는 `constructor` 같은 이름)은 null. */
export function googleResultMessage(result: string | null): string | null {
  if (!result || !Object.hasOwn(GOOGLE_RESULT_MESSAGE, result)) return null;
  return GOOGLE_RESULT_MESSAGE[result];
}

/** 초대 링크(/signup?code=…)로 왔다면 Google 설정 화면까지 코드를 들고 갑니다. */
export const INVITE_CODE_STORAGE_KEY = "ctrlai.invite-code";
