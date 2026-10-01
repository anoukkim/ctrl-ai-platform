/**
 * Admin — 관리 화면.
 *
 * Phase 1c부터 목업이 없습니다. 회원 목록, 참여 상태, 지원금 조정, 감사
 * 로그가 모두 백엔드의 실제 데이터입니다.
 *
 * 화면이 하나의 분기를 중심으로 돕니다. 참여도 지원금도 분기마다 따로
 * 이므로, 어느 분기를 보고 있는지가 분명해야 숫자를 읽을 수 있습니다.
 */

import type { Metadata } from "next";

import BackendStatus from "@/app/components/BackendStatus";
import AdminWorkspace from "./AdminWorkspace";

import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Admin — Ctrl AI",
};

export default function AdminPage() {
  return (
    <>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">
          회원 관리, 분기 관리, 지원금 관리를 담당합니다. 제공자 이용 권한은 Ctrl AI가 갖고
          회원별 사용량을 기록하므로, 회원이 직접 API 키를 보관하지 않습니다.
        </p>
      </header>

      <div className={styles.sections}>
        <AdminWorkspace />

        <section>
          <h2 className="section-title">콘텐츠 관리</h2>
          <div className="card">
            <p className="small muted">
              게시된 앱과 영상을 숨기거나 댓글을 정리하는 기능은 이후 단계에서 추가합니다.
              탈퇴 회원의 작품이라도 만든 사람의 이름은 계속 표시됩니다.
            </p>
          </div>
        </section>

        <section>
          <h2 className="section-title">시스템</h2>
          <BackendStatus />
        </section>
      </div>
    </>
  );
}
