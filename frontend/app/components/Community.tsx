/**
 * CtrlAIApps와 CtrlAITube의 카드 목록이 함께 쓰는 "만든 사람" 표시.
 *
 * 반응과 댓글도 한때 이 파일에 있었습니다. 둘 다 눌러도 아무 일이
 * 일어나지 않는 Phase 0 표시였고, 지금은 실제로 움직이는 것이
 * `CommentSection.tsx`에 있습니다 — 반응 칩, 탭, 댓글칸. 읽기 전용
 * 표시를 함께 남겨 두면 어느 쪽을 써야 하는지 알 수 없으므로 지웠습니다.
 */

import { MEMBERSHIP_LABEL, type Creator } from "@/lib/mock-data";
import { MEMBERSHIP_BADGE } from "@/lib/quarters";

import styles from "./community.module.css";

/**
 * 만든 사람을 표시합니다.
 *
 * 커뮤니티를 떠나도 이름은 지우지 않습니다. 탈퇴 회원이 게시한 작품에도
 * 만든 사람의 이름이 그대로 남습니다.
 */
export function CreatorLine({ creator, prefix = "만든 사람" }: { creator: Creator; prefix?: string }) {
  return (
    <span className={styles.creator}>
      <span className="muted">{prefix}</span>
      <span className={styles.creatorName}>{creator.displayName}</span>
      <span className={`badge ${MEMBERSHIP_BADGE[creator.membership]}`}>
        {MEMBERSHIP_LABEL[creator.membership]}
      </span>
    </span>
  );
}
