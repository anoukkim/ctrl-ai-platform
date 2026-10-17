"use client";

/**
 * 만드는 중의 미리보기 칸 (running-state-calm) — Builder.
 *
 * 오너: "모션이 너무 subtle 한 것 같은데 뭔가 돌아가고 있다는게 잘 안보임..
 * 화면에 글자가 띄워진다던가 너무 길게는 말고". 그래서 단계 이름과 흐르는
 * 시간을 크게, 짧게 보여 줍니다. 단계는 **실제 진행**만 따릅니다 — 계획을
 * 세우는 중(요구사항 읽기), 파일마다 시작·완료 소식(파일 쓰기), 점검과
 * 미리보기 다시 쓰기(미리보기 조립). 소식이 없는 단계는 퍼센트 대신 위의
 * 흐르는 막대(정해지지 않은 진행)와 시간만. 파일 칩은 쓰는 중 → 완료, 코드
 * 창은 마지막으로 다 쓴 파일의 끝 몇 줄(진짜 내용)입니다. 오로라는
 * Profile › 오로라 배경으로 끌 수 있는 아주 은은한 빛.
 */

import { useState } from "react";

import WorkingSince from "@/app/components/WorkingSince";
import { useAurora } from "@/lib/aurora";
import { formatKrw } from "@/lib/quarters";

import styles from "./run-panel.module.css";

export const STAGES = ["요구사항 읽기", "파일 쓰기", "미리보기 조립"] as const;

export interface RunFile {
  path: string;
  state: "writing" | "done" | "waiting";
}

interface Props {
  /** 0 요구사항 읽기 · 1 파일 쓰기 · 2 미리보기 조립. */
  stage: 0 | 1 | 2;
  since: number | null;
  files: RunFile[];
  /** 마지막으로 다 쓴 파일의 끝 몇 줄. */
  tail: { path: string; lines: string[] } | null;
  costKrw: number | null;
}

export default function BuilderRunPanel({ stage, since, files, tail, costKrw }: Props) {
  const [mountedAt] = useState(() => Date.now());
  const aurora = useAurora();
  return (
    <div className={styles.panel} data-testid="builder-run-panel">
      <span className="run-sweep run-sweep--top" aria-hidden="true" />
      {aurora && (
        <span className={styles.aurora} aria-hidden="true" data-testid="aurora-glow">
          <span className={styles.blob} />
          <span className={`${styles.blob} ${styles.blob2}`} />
        </span>
      )}
      <div className={styles.head}>
        {/* The words the owner wanted visible: the stage, large; the time, larger. */}
        <p className={styles.stageNow} data-testid="run-stage">
          {STAGES[stage]} 중…
        </p>
        <WorkingSince since={since ?? mountedAt} className={styles.timer} />
      </div>
      <ol className={styles.stages} aria-label="단계">
        {STAGES.map((label, index) => (
          <li key={label} data-state={index < stage ? "done" : index === stage ? "now" : "todo"}>
            <span className={styles.mark} aria-hidden="true">
              {index < stage ? "✓" : ""}
            </span>
            {label}
            {index === stage && <span className={styles.nowNote}> · 진행 중</span>}
          </li>
        ))}
      </ol>
      {files.length > 0 && (
        <ul className={styles.files} aria-label="파일">
          {files.map((file) => (
            <li key={file.path} data-state={file.state}>
              {file.path}
              {file.state === "writing" ? " · 쓰는 중" : file.state === "done" ? " · 완료" : ""}
            </li>
          ))}
        </ul>
      )}
      {tail && tail.lines.length > 0 && (
        <pre className={styles.code} aria-label={`${tail.path}의 끝부분`} data-testid="run-tail">
          {tail.lines.join("\n")}
          <span className={styles.caret} aria-hidden="true" />
        </pre>
      )}
      <p className={styles.foot}>
        {costKrw ? `지금까지 약 ${formatKrw(costKrw)} · ` : ""}만드는 동안 다른 화면으로 가도 계속돼요.
      </p>
    </div>
  );
}

/** The last `count` non-empty lines of a file, for the code window. */
export function tailOf(content: string, count = 7): string[] {
  return content
    .replace(/\s+$/, "")
    .split("\n")
    .slice(-count);
}
