"use client";

/**
 * Claude 판의 대화 — 이 프로젝트가 바뀌어 온 길 (quality-tuning Q3).
 *
 * 저장된 버전마다: 회원의 부탁(내 말풍선) → Claude가 한 일 + "v3 · 파일 2개
 * 바뀜 · 31원"(Claude 말풍선)과 이 버전 보기 / 되돌리기. 되돌리기처럼
 * Claude가 만들지 않은 버전은 가운데 작은 줄 하나. 오래된 것부터 위에서
 * 아래로, 채팅과 같은 순서입니다. 숫자는 모두 백엔드가 준 값입니다.
 */

import { formatKrw } from "@/lib/quarters";
import type { BuilderVersion } from "@/lib/projects";
import ws from "@/app/components/workspace.module.css";

import styles from "./workspace.module.css";

interface Props {
  /** 최신이 먼저 오는 버전 목록 (`listVersions` 그대로). */
  versions: BuilderVersion[];
  /** 지금 미리보기로 보고 있는 지난 버전. */
  viewing: number | null;
  onView: (version: BuilderVersion) => void;
  onRestore: (version: BuilderVersion) => void;
  restoreDisabled: boolean;
  restoreTitle?: string;
}

/** 숫자 뒤의 "로/으로": 삼으로, 이로, 칠로 (백엔드 버전 메모와 같은 규칙). */
export function particleRo(n: number): string {
  return [0, 3, 6].includes(n % 10) ? "으로" : "로";
}

/** "v3 · 파일 2개 바뀜 · 31원" — 모르는 값은 빼고. */
export function versionMeta(version: BuilderVersion): string {
  return [
    `v${version.number}`,
    version.changed_count != null ? `파일 ${version.changed_count}개 바뀜` : null,
    version.charged_krw != null ? formatKrw(version.charged_krw) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function ClaudeHistory({
  versions,
  viewing,
  onView,
  onRestore,
  restoreDisabled,
  restoreTitle,
}: Props) {
  const latest = versions[0]?.number ?? null;
  const ordered = [...versions].reverse();

  return (
    <ol className={styles.history} aria-label="바뀌어 온 기록">
      {ordered.map((version) => {
        const actions = (
          <span className={styles.historyActions}>
            {version.number === latest ? (
              <span className="badge badge-muted">지금</span>
            ) : (
              <>
                <button
                  className="btn btn-sm"
                  type="button"
                  aria-pressed={viewing === version.number}
                  aria-label={`v${version.number} 이 버전 보기`}
                  onClick={() => onView(version)}
                >
                  이 버전 보기
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  aria-label={`v${version.number}${particleRo(version.number)} 되돌리기`}
                  onClick={() => onRestore(version)}
                  disabled={restoreDisabled}
                  title={restoreTitle}
                >
                  되돌리기
                </button>
              </>
            )}
          </span>
        );

        if (!version.request) {
          return (
            <li className={styles.historyEvent} key={version.number}>
              <span>
                <strong>v{version.number}</strong> · {version.label || version.note || "변경"}
              </span>
              {actions}
            </li>
          );
        }

        return (
          <li className={styles.historyTurn} key={version.number}>
            <div className={`${ws.chatMessage} ${ws.chatUser}`}>
              <span className={ws.chatRole}>나</span>
              {version.request}
            </div>
            <div className={`${ws.chatMessage} ${ws.chatAssistant}`}>
              <span className={ws.chatRole}>Claude</span>
              {version.summary || version.note}
              <span className={styles.historyMeta}>{versionMeta(version)}</span>
              {actions}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
