"use client";

/**
 * 접는 섹션 (ui-improvements B) — Admin › AI Models · Budget · System.
 *
 * 오너: "너무 복잡해 너무 줄줄이 길어 차라리 하나씩 토글해서 볼 수
 * 있으면". 그래서 한 화면의 섹션은 **한 번에 하나만** 펼쳐지고(아코디언),
 * 어느 것을 펼쳐 두었는지는 이 브라우저가 기억합니다(`adminPrefs`).
 *
 * 접힌 줄에는 제목과 함께 한 줄 요약을 보여 줄 수 있습니다 — 펼치지
 * 않고도 숫자가 보이도록. 접힌 섹션의 내용은 그리지 않으므로, 자기 자료를
 * 스스로 불러오는 판은 펼칠 때 비로소 부릅니다.
 *
 * `FoldGroup` 밖에서 쓰인 `Fold`는 늘 펼쳐진 보통 섹션입니다 — 판을
 * 혼자 그리는 테스트와, 아직 묶지 않은 화면을 위해.
 */

import { createContext, useContext, type ReactNode } from "react";

import { adminPrefs } from "@/lib/layout-prefs";

import styles from "../admin.module.css";

interface GroupState {
  open: string | null;
  toggle: (key: string) => void;
}

const GroupContext = createContext<GroupState | null>(null);

/** 빈 문자열 = "모두 접음"을 기억한 것. null = 기억 없음(기본값을 씁니다). */
function storedOpen(value: string | null, fallback: string | null): string | null {
  if (value === null) return fallback;
  return value === "" ? null : value;
}

export function FoldGroup({
  screen,
  defaultOpen = null,
  children,
}: {
  /** 기억 키 — 화면마다 하나(`ai-models`, `budget`, `system`). */
  screen: string;
  /** 기억이 없을 때 펼쳐 둘 섹션. null이면 모두 접힌 채로 시작합니다. */
  defaultOpen?: string | null;
  children: ReactNode;
}) {
  const key = `${screen}.open`;
  const open = storedOpen(adminPrefs.usePref(key), defaultOpen);

  const toggle = (next: string) => {
    adminPrefs.writePref(key, open === next ? "" : next);
  };

  return <GroupContext.Provider value={{ open, toggle }}>{children}</GroupContext.Provider>;
}

export default function Fold({
  id,
  title,
  note,
  summary,
  forceOpen = false,
  children,
}: {
  /** 묶음 안에서의 이름. 제목 요소의 id에도 쓰입니다. */
  id: string;
  title: ReactNode;
  /** 제목 옆의 작은 설명. */
  note?: ReactNode;
  /** 접혀 있을 때 제목 줄 오른쪽에 보이는 한 줄 요약. */
  summary?: ReactNode;
  /** 검색 중처럼 결과가 보여야 할 때 — 기억과 상관없이 펼칩니다. */
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const group = useContext(GroupContext);
  const headingId = `fold-${id}`;
  const bodyId = `fold-${id}-body`;

  if (group === null) {
    return (
      <section aria-labelledby={headingId}>
        <h2 className="section-title" id={headingId}>
          {title}
          {note && <span className={styles.sectionNote}>{note}</span>}
        </h2>
        {children}
      </section>
    );
  }

  const open = forceOpen || group.open === id;

  return (
    <section className={styles.fold} aria-labelledby={headingId} data-open={open ? "true" : "false"}>
      <div className={styles.foldHead}>
        <h2 className={`section-title ${styles.foldTitle}`} id={headingId}>
          <button
            className={styles.foldButton}
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => group.toggle(id)}
          >
            <span className={`${styles.foldChevron} ${open ? styles.foldChevronOpen : ""}`} aria-hidden="true">
              ▸
            </span>
            <span className={styles.foldTitleText}>{title}</span>
          </button>
          {/* 설명은 단추 밖에 — 단추의 이름은 제목만이어야 합니다. */}
          {note && <span className={styles.sectionNote}>{note}</span>}
        </h2>
        {summary && !open && <span className={styles.foldSummary}>{summary}</span>}
      </div>
      {open && (
        <div className={styles.foldBody} id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
