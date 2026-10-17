/**
 * 지금 돌고 있는 일 (running-state-calm) — Chat 답장과 Builder 만들기.
 *
 * 화면을 옮겨도 사이드바의 점과 목록의 "작업 중"이 남도록, 컴포넌트 밖에
 * 둡니다 — 모듈 하나가 이 탭의 상태입니다(Next의 화면 이동은 페이지를 다시
 * 불러오지 않으므로 남습니다). 새로 고침에는 남기지 않습니다: 그 일을
 * 지켜보던 연결이 끊겨 끝났는지 알 길이 없고, 모르는 것을 "도는 중"이라고
 * 보여 줄 수는 없으니까요. 끝나면 각 화면이 `finishRun`으로 지웁니다.
 */

import { useSyncExternalStore } from "react";

export type RunKind = "chat" | "builder";

export interface Run {
  kind: RunKind;
  /** 대화 id 또는 프로젝트 id. 새 대화처럼 아직 없으면 0. */
  id: number;
  startedAt: number;
}

let runs: Run[] = [];
const listeners = new Set<() => void>();

function save() {
  for (const listener of listeners) listener();
}

export function startRun(kind: RunKind, id: number, startedAt = Date.now()): void {
  runs = [...runs.filter((run) => !(run.kind === kind && run.id === id)), { kind, id, startedAt }];
  save();
}

export function finishRun(kind: RunKind, id: number): void {
  const next = runs.filter((run) => !(run.kind === kind && run.id === id));
  if (next.length === runs.length) return;
  runs = next;
  save();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: Run[] = [];

export function useRuns(): Run[] {
  return useSyncExternalStore(
    subscribe,
    () => runs,
    () => EMPTY,
  );
}

export function isRunning(list: Run[], kind: RunKind, id?: number): boolean {
  return list.some((run) => run.kind === kind && (id === undefined || run.id === id));
}

/** Tests only. */
export function resetRuns(): void {
  runs = [];
  save();
}
