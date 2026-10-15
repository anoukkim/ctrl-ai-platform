import type { Metadata } from "next";

import ConnectScreen from "./ConnectScreen";

export const metadata: Metadata = {
  title: "앱 연결 — CTRL+AI",
};

export default function ConnectPage() {
  return <ConnectScreen />;
}
