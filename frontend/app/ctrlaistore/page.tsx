/**
 * CtrlAIStore — 회원들이 만든 앱을 모아 보는 곳.
 *
 * Project Builder의 프로젝트는 혼자 작업하는 공간이고, 여기에 올라온
 * 앱은 커뮤니티에 공개된 결과물입니다.
 */

import type { Metadata } from "next";
import { MOCK_APPS } from "@/lib/mock-data";

import AppGrid from "./AppGrid";

export const metadata: Metadata = {
  title: "CtrlAIApps — CTRL+AI",
};

export default function CtrlAIStorePage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          CtrlAIApps <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          회원들이 Project Builder로 만들어 게시한 앱입니다. 만든 사람이 이번 시즌에
          참여하지 않더라도 앱은 그대로 남아 있습니다.
        </p>
        <span className="badge badge-muted">{MOCK_APPS.length}개</span>
      </header>

      <AppGrid />
    </>
  );
}
