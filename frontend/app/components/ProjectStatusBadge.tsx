/**
 * 프로젝트 상태 — 배지는 "Draft"와 "게시됨" 둘뿐이고, 만드는 중에는
 * 배지 대신 "생성 중…" 표시입니다. 규칙은 `lib/projects.ts`의
 * `projectBadge()`에 있고, 여기는 그것을 그리기만 합니다.
 *
 * 목록 카드와 작업 공간의 머리줄이 같은 것을 씁니다.
 */

import { projectBadge, type ProjectStatus } from "@/lib/projects";

export default function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const badge = projectBadge(status);
  if (badge.kind === "working") {
    return (
      <span className="working" role="status">
        {badge.label}
      </span>
    );
  }
  return <span className={`badge ${badge.className}`}>{badge.label}</span>;
}
