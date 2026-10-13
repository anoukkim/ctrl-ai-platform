import type { Metadata } from "next";

import SignupForm from "./SignupForm";

export const metadata: Metadata = {
  title: "회원가입 — CTRL+AI",
};

/**
 * 회원가입. 초대 코드가 있어야 가입할 수 있습니다(invite-only-signup).
 *
 * 관리자가 복사해 주는 링크 `/signup?code=…`로 오면 코드 칸이 미리
 * 채워집니다. 칸을 채워 줄 뿐이고, 코드가 쓸 수 있는지는 가입할 때
 * 백엔드가 확인합니다.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { code } = await searchParams;
  return <SignupForm initialCode={typeof code === "string" ? code : ""} />;
}
