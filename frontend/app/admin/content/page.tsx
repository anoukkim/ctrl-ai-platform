/**
 * Admin — 콘텐츠 (/admin/content)
 *
 * 아직 만들지 않았습니다. 앱과 영상이 실제로 게시되는 것은 Phase 5와
 * Phase 8이고, 숨길 것이 없는 상태에서 숨기기 기능을 만들 수는 없습니다.
 *
 * 그래도 자리를 비워 두는 이유: 메뉴에 들어가야 할 구역이 빠져 있으면
 * 나중에 메뉴 구조를 다시 짜게 됩니다.
 */

import { sectionLabel } from "../sections";

export default function AdminContentPage() {
  return (
    <>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">
          {sectionLabel("content")} <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          게시된 앱과 영상을 숨기거나 댓글을 정리하는 화면입니다.
        </p>
      </header>

      <div className="card">
        <p className="small muted">
          앱 게시는 Phase 5, 영상 게시는 Phase 8에서 만듭니다. 그때 이 화면에 숨기기와
          댓글 정리가 들어옵니다.
        </p>
        <p className="small muted" style={{ marginTop: "0.7rem" }}>
          숨기더라도 만든 사람의 이름은 지우지 않습니다. 탈퇴한 회원의 작품에도 &ldquo;탈퇴
          회원&rdquo;으로 이름이 계속 남습니다 — 게시한 작품의 출처를 지우는 것은 기록을
          고치는 일이기 때문입니다.
        </p>
      </div>
    </>
  );
}
