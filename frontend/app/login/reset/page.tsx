import type { Metadata } from "next";

import ResetPasswordForm from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "새 비밀번호 — CTRL+AI",
};

/** 비밀번호를 잊었어요(signup-google-first): Google로 확인한 뒤 새 비밀번호를 만드는 화면. */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
