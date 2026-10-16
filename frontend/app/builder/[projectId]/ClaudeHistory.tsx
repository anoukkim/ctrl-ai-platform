"use client";

/**
 * Claude 판의 대화 — 이 프로젝트가 바뀌어 온 길 (quality-tuning Q3).
 *
 * builder-snapshots: 저장한 버전이 아니라 **작업 단계**(실행 취소 기록)마다
 * 보여 줍니다. Claude가 한 단계는 회원의 부탁(내 말풍선) → Claude가 한 일
 * + "파일 2개 바뀜 · 31원"(Claude 말풍선)과 이 단계로 되돌리기. 불러오기처럼
 * Claude가 만들지 않은 단계는 가운데 작은 줄 하나. 오래된 것부터 위에서
 * 아래로, 채팅과 같은 순서입니다. 숫자는 모두 백엔드가 준 값입니다.
 * 저장한 버전은 아래 "저장한 버전" 목록에 있어요.
 */

import { formatKrw } from "@/lib/quarters";
import type { BuilderStep } from "@/lib/projects";
import ws from "@/app/components/workspace.module.css";

import styles from "./workspace.module.css";

interface Props {
  /** 오래된 것부터 오는 작업 단계 (`getHistory().steps` 그대로). */
  steps: BuilderStep[];
  onGoTo: (step: BuilderStep) => void;
  restoreDisabled: boolean;
  restoreTitle?: string;
}

/** 숫자 뒤의 "로/으로": 삼으로, 이로, 칠로. */
export function particleRo(n: number): string {
  return [0, 3, 6].includes(n % 10) ? "으로" : "로";
}

/** "파일 2개 바뀜 · 31원" — 모르는 값은 빼고. */
export function stepMeta(step: BuilderStep): string {
  return [
    step.changed_count != null ? `파일 ${step.changed_count}개 바뀜` : null,
    step.charged_krw != null ? formatKrw(step.charged_krw) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function ClaudeHistory({ steps, onGoTo, restoreDisabled, restoreTitle }: Props) {
  return (
    <ol className={styles.history} aria-label="바뀌어 온 기록">
      {steps.map((step) => {
        const actions = (
          <span className={styles.historyActions}>
            {step.current ? (
              <span className="badge badge-muted">지금</span>
            ) : (
              <button
                className="btn btn-sm"
                type="button"
                aria-label={`${step.note || "이 단계"} 때로 되돌리기`}
                onClick={() => onGoTo(step)}
                disabled={restoreDisabled}
                title={restoreTitle}
              >
                이 단계로
              </button>
            )}
          </span>
        );

        if (!step.request) {
          return (
            <li className={styles.historyEvent} key={step.seq}>
              <span>{step.note || "변경"}</span>
              {actions}
            </li>
          );
        }

        return (
          <li className={styles.historyTurn} key={step.seq}>
            <div className={`${ws.chatMessage} ${ws.chatUser}`}>
              <span className={ws.chatRole}>나</span>
              {step.request}
            </div>
            <div className={`${ws.chatMessage} ${ws.chatAssistant}`}>
              <span className={ws.chatRole}>Claude</span>
              {step.summary || step.note}
              <span className={styles.historyMeta}>{stepMeta(step)}</span>
              {actions}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
