/**
 * Project Builder — 작업 공간 화면.
 *
 * 이 화면은 화면 전체를 작업 공간으로 씁니다. AppShell이 `/builder`를
 * 작업 공간 경로로 알고 있어 여백과 최대 너비를 없애 줍니다.
 */

import type { Metadata } from "next";

import BuilderWorkspace from "./BuilderWorkspace";

export const metadata: Metadata = {
  title: "Project Builder — Ctrl AI",
};

export default function BuilderPage() {
  return <BuilderWorkspace />;
}
