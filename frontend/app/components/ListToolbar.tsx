/**
 * 목록 화면의 머리 줄 — Project Builder · CtrlAIApps · Video Generator ·
 * CtrlAITube가 **같은 격자**를 씁니다 (ui-improvements).
 *
 * 세 자리: 왼쪽의 라벨(개수나 정렬 칩), 가운데의 검색, 오른쪽의 조절
 * 단추들(상태 필터 · 정렬 · 고정). 검색은 오른쪽 끝에 붙어 서므로 검색창의
 * 오른쪽 끝이 늘 카드 줄의 끝과 맞습니다 — 조절 단추가 있으면 그 바로
 * 왼쪽에, 없으면 줄 끝에. 좁은 화면에서는 검색이 한 줄을 다 쓰고 나머지가
 * 위에 섭니다.
 */

import type { ReactNode } from "react";

import styles from "./list-toolbar.module.css";

interface Props {
  /** 왼쪽: "내 프로젝트 3개" 같은 라벨, 또는 정렬 칩. */
  label?: ReactNode;
  /** 가운데: SearchBar. */
  search?: ReactNode;
  /** 오른쪽: 상태 필터·정렬·고정 같은 조절 단추들. */
  controls?: ReactNode;
}

export default function ListToolbar({ label, search, controls }: Props) {
  return (
    <div className={styles.toolbar} data-testid="list-toolbar">
      {label !== undefined && label !== null && <div className={styles.label}>{label}</div>}
      {search && <div className={styles.search}>{search}</div>}
      {controls && <div className={styles.controls}>{controls}</div>}
    </div>
  );
}
