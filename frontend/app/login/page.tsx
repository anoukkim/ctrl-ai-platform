import type { Metadata } from "next";

import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "로그인 — CTRL+AI",
};

export default function LoginPage() {
  return <LoginForm />;
}
