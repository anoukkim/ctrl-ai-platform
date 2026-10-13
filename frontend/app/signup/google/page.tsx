import type { Metadata } from "next";

import GoogleSetupForm from "./GoogleSetupForm";

export const metadata: Metadata = {
  title: "가입 마무리 — CTRL+AI",
};

/** 처음 Google로 들어온 사람이 아이디와 초대 코드를 정하는 화면(google-login). */
export default function GoogleSetupPage() {
  return <GoogleSetupForm />;
}
